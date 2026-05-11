/**
 * MezRange Keeper Bot
 *
 * Monitors strategy contracts on Mezo and:
 * - calls strategy.rebalance() when shouldRebalance() returns true
 * - calls vault.compoundFees() on a fixed cadence so performance fees are charged correctly
 *
 * Usage:
 *   npm run keeper
 *
 * Env vars:
 *   RPC_URL         - Mezo RPC endpoint
 *   KEEPER_PK       - Keeper wallet private key
 *   STRATEGY_ADDRS  - Optional comma-separated strategy addresses
 *   VAULT_ADDRS     - Optional comma-separated vault addresses aligned with STRATEGY_ADDRS
 *   POLL_MS         - Poll interval in ms (default: 12000)
 *   COMPOUND_MS     - Compound interval in ms (default: 3600000)
 *   MAX_GAS_GWEI    - Skip a tx if network gas price exceeds this (default: 50)
 */

import { ethers } from 'ethers';
import { DEPLOYED_CONTRACTS } from '../src/data/deployedContracts';

const RPC_URL      = process.env.RPC_URL ?? 'https://rpc.test.mezo.org';
const KEEPER_PK    = process.env.KEEPER_PK ?? '';
const POLL_MS      = parseInt(process.env.POLL_MS     ?? '12000', 10);
const COMPOUND_MS  = parseInt(process.env.COMPOUND_MS ?? `${60 * 60 * 1000}`, 10);
const MAX_GAS_GWEI = process.env.MAX_GAS_GWEI ?? '50';
const MAX_GAS_PRICE = ethers.parseUnits(MAX_GAS_GWEI, 'gwei');

// Recreate the JsonRpcProvider after this many consecutive network-class failures
// across all watched vaults. Mezo RPC nodes occasionally hold a stale socket open.
const PROVIDER_RESET_AFTER = 8;

// Cap on per-vault backoff between failed attempts (5 minutes).
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// keccak256("KEEPER_ROLE")
const KEEPER_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes('KEEPER_ROLE'));

const STRATEGY_ABI = [
  'function shouldRebalance() external view returns (bool)',
  'function rebalance() external',
  'function rebalanceCount() external view returns (uint256)',
  'function currentTickLower() external view returns (int24)',
  'function currentTickUpper() external view returns (int24)',
  'function positionActive() external view returns (bool)',
  'function paused() external view returns (bool)',
  'function hasRole(bytes32, address) external view returns (bool)',
];

const VAULT_ABI = [
  'function compoundFees() external',
  'function paused() external view returns (bool)',
  'function hasRole(bytes32, address) external view returns (bool)',
];

interface WatchedVault {
  label: string;
  strategy: string;
  vault: string;
}

interface KeeperState {
  consecutiveFailures: number;
  totalRebalances: number;
  totalCompounds: number;
  lastRebalanceAt: number;
  lastCompoundAt: number;
  nextAttemptAt: number;
}

interface Runtime {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
  networkFailures: number;
}

const state: Record<string, KeeperState> = {};
let stopping = false;

function ts(): string {
  return new Date().toISOString();
}

function logInfo(label: string, msg: string): void {
  console.log(`${ts()} [${label}] ${msg}`);
}

function logErr(label: string, msg: string): void {
  console.error(`${ts()} [${label}] ${msg}`);
}

function configuredVaults(): WatchedVault[] {
  const envStrategies = (process.env.STRATEGY_ADDRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const envVaults     = (process.env.VAULT_ADDRS    ?? '').split(',').map((v) => v.trim()).filter(Boolean);

  if (envStrategies.length > 0) {
    return envStrategies.map((strategy, index) => ({
      label: `env-${index + 1}`,
      strategy,
      vault: envVaults[index] ?? '',
    }));
  }

  const defaults = DEPLOYED_CONTRACTS.testnet.vaults;
  return [
    { label: 'btc-musd-50',   strategy: defaults.btcMusd.strategy,   vault: defaults.btcMusd.vault   },
    { label: 'mezo-musd-200', strategy: defaults.mezoMusd.strategy,  vault: defaults.mezoMusd.vault  },
    { label: 'btc-musd-10',   strategy: defaults.btcMusd10.strategy, vault: defaults.btcMusd10.vault },
  ];
}

function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'timeout',
    'network',
    'temporarily unavailable',
    'socket hang up',
    'econnreset',
    'econnrefused',
    'enotfound',
    'fetch failed',
  ].some((fragment) => message.includes(fragment));
}

function isRetryableError(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'nonce',
    'underpriced',
    'replacement fee too low',
  ].some((fragment) => message.includes(fragment));
}

/**
 * Backoff with ±15% jitter so multiple vaults that fail in the same cycle don't
 * retry in lockstep against the RPC (thundering-herd).
 */
function jitter(ms: number): number {
  const delta = ms * 0.15;
  return Math.max(POLL_MS, Math.round(ms + (Math.random() * 2 - 1) * delta));
}

async function buildTxRequest(
  contract: ethers.Contract,
  method: 'rebalance' | 'compoundFees',
  signer: ethers.Wallet,
): Promise<ethers.TransactionRequest> {
  const provider = signer.provider;
  if (!provider) throw new Error('Signer provider unavailable');

  const feeData  = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? MAX_GAS_PRICE;
  if (gasPrice > MAX_GAS_PRICE) {
    throw new Error(`Gas too high (${ethers.formatUnits(gasPrice, 'gwei')} gwei > ${MAX_GAS_GWEI})`);
  }

  const txRequest = method === 'rebalance'
    ? await contract.rebalance.populateTransaction()
    : await contract.compoundFees.populateTransaction();

  const gasEstimate = await provider.estimateGas({
    ...txRequest,
    from: signer.address,
  });

  return {
    ...txRequest,
    nonce: await provider.getTransactionCount(signer.address, 'pending'),
    gasLimit: (gasEstimate * 120n) / 100n,
    gasPrice,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
  };
}

async function sendManagedTx(
  contract: ethers.Contract,
  method: 'rebalance' | 'compoundFees',
  signer: ethers.Wallet,
  label: string,
): Promise<ethers.TransactionReceipt | null> {
  const request = await buildTxRequest(contract, method, signer);
  const response = await signer.sendTransaction(request);
  logInfo(label, `${method} tx sent: ${response.hash}`);
  return response.wait();
}

/**
 * Verify the keeper wallet actually holds KEEPER_ROLE on every watched contract.
 * Fails fast on startup so we don't burn a poll cycle on a guaranteed revert.
 */
async function preflight(
  rt: Runtime,
  watched: WatchedVault[],
): Promise<void> {
  logInfo('preflight', `keeper=${rt.signer.address}`);
  const bal = await rt.provider.getBalance(rt.signer.address);
  logInfo('preflight', `keeper native balance: ${ethers.formatEther(bal)}`);
  if (bal === 0n) {
    throw new Error('Keeper has zero native balance — top up before running');
  }

  for (const v of watched) {
    const strat = new ethers.Contract(v.strategy, STRATEGY_ABI, rt.provider);
    const ok = await strat.hasRole(KEEPER_ROLE_HASH, rt.signer.address);
    if (!ok) {
      throw new Error(
        `[${v.label}] strategy ${v.strategy} did not grant KEEPER_ROLE to ${rt.signer.address}`,
      );
    }
    if (v.vault) {
      const vault = new ethers.Contract(v.vault, VAULT_ABI, rt.provider);
      const okV = await vault.hasRole(KEEPER_ROLE_HASH, rt.signer.address);
      if (!okV) {
        throw new Error(
          `[${v.label}] vault ${v.vault} did not grant KEEPER_ROLE to ${rt.signer.address}`,
        );
      }
    }
    logInfo('preflight', `${v.label}: KEEPER_ROLE OK`);
  }
}

async function runKeeperCycle(rt: Runtime, watched: WatchedVault): Promise<void> {
  const strategy = new ethers.Contract(watched.strategy, STRATEGY_ABI, rt.provider);
  const vault    = watched.vault ? new ethers.Contract(watched.vault, VAULT_ABI, rt.provider) : null;
  const vs       = state[watched.strategy];

  if (Date.now() < vs.nextAttemptAt) return;

  try {
    // Skip work entirely if the strategy is paused — saves an RPC round and an estimateGas revert.
    if (await strategy.paused()) {
      vs.nextAttemptAt = 0;
      vs.consecutiveFailures = 0;
      return;
    }

    const [positionActive, needsRebalance, lower, upper] = await Promise.all([
      strategy.positionActive(),
      strategy.shouldRebalance(),
      strategy.currentTickLower(),
      strategy.currentTickUpper(),
    ]);

    if (positionActive && needsRebalance) {
      logInfo(watched.label, `rebalance triggered (range [${lower}, ${upper}])`);
      const receipt = await sendManagedTx(strategy.connect(rt.signer), 'rebalance', rt.signer, watched.label);
      if (receipt?.status !== 1n) throw new Error('rebalance transaction reverted');
      vs.totalRebalances += 1;
      vs.lastRebalanceAt = Date.now();
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      return;
    }

    if (!vault) return;
    if (await vault.paused()) {
      vs.nextAttemptAt = 0;
      vs.consecutiveFailures = 0;
      return;
    }

    const compoundDue = Date.now() - vs.lastCompoundAt >= COMPOUND_MS;
    if (!positionActive || !compoundDue) {
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      return;
    }

    logInfo(watched.label, 'compoundFees due');
    const receipt = await sendManagedTx(vault.connect(rt.signer), 'compoundFees', rt.signer, watched.label);
    if (receipt?.status !== 1n) throw new Error('compoundFees transaction reverted');
    vs.totalCompounds += 1;
    vs.lastCompoundAt = Date.now();
    vs.consecutiveFailures = 0;
    vs.nextAttemptAt = 0;
  } catch (error) {
    vs.consecutiveFailures += 1;
    const baseBackoff = POLL_MS * (2 ** Math.min(vs.consecutiveFailures, 6));
    vs.nextAttemptAt = Date.now() + jitter(Math.min(baseBackoff, MAX_BACKOFF_MS));

    if (isNetworkError(error)) rt.networkFailures += 1;

    const message = error instanceof Error ? error.message : String(error);
    logErr(watched.label, message);
    if (!isRetryableError(error)) {
      logErr(watched.label, 'non-retryable error — backoff in place, manual attention may be required');
    }
  }
}

function createRuntime(): Runtime {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(KEEPER_PK, provider);
  return { provider, signer, networkFailures: 0 };
}

async function main() {
  if (!KEEPER_PK) {
    logErr('boot', 'KEEPER_PK not set');
    process.exit(1);
  }

  const watchedVaults = configuredVaults().filter((vault) => vault.strategy);
  if (watchedVaults.length === 0) {
    logErr('boot', 'No strategy addresses configured');
    process.exit(1);
  }

  let rt = createRuntime();

  for (const watched of watchedVaults) {
    state[watched.strategy] = {
      consecutiveFailures: 0,
      totalRebalances: 0,
      totalCompounds: 0,
      lastRebalanceAt: 0,
      lastCompoundAt: 0,
      nextAttemptAt: 0,
    };
  }

  logInfo('boot', `keeper=${rt.signer.address} rpc=${RPC_URL}`);
  logInfo('boot', `watching ${watchedVaults.length} vaults; poll=${POLL_MS}ms compound=${COMPOUND_MS}ms`);

  try {
    await preflight(rt, watchedVaults);
  } catch (err) {
    logErr('preflight', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logInfo('shutdown', `received ${signal}; finishing in-flight work and exiting`);
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  let cycle = 0;
  while (!stopping) {
    cycle += 1;
    if (cycle % 10 === 0) {
      const summary = watchedVaults
        .map((w) => {
          const s = state[w.strategy];
          return `${w.label}=R${s.totalRebalances}/C${s.totalCompounds}/F${s.consecutiveFailures}`;
        })
        .join(' ');
      logInfo('heartbeat', `cycle=${cycle} ${summary}`);
    }

    await Promise.allSettled(watchedVaults.map((watched) => runKeeperCycle(rt, watched)));

    // Persistent network errors → cycle the provider. We don't reset state so any
    // in-progress backoffs continue to apply on the new connection.
    if (rt.networkFailures >= PROVIDER_RESET_AFTER) {
      logErr('runtime', `provider had ${rt.networkFailures} network failures; reconnecting`);
      try {
        rt.provider.destroy?.();
      } catch { /* best-effort */ }
      rt = createRuntime();
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  logInfo('shutdown', 'goodbye');
  process.exit(0);
}

main().catch((error) => {
  logErr('fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
