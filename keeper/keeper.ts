/**
 * MezRange Keeper Bot
 *
 * Hybrid keeper inspired by UniRange / Chainlink CRE:
 *   - PRIMARY:  Event-driven — listens to Swap events on each pool (like Chainlink CRE
 *               logTrigger) and checks shouldRebalance() immediately on every swap.
 *               This catches out-of-range conditions in the same block as the price moves.
 *   - FALLBACK: Poll-based — every POLL_MS checks all vaults, catches anything missed
 *               by the event listener (e.g. WebSocket drops).
 *   - COMPOUND: Fixed-cadence hourly call to vault.compoundFees().
 *
 * Usage:
 *   npm run keeper
 *
 * Env vars:
 *   RPC_URL         - Mezo RPC endpoint (wss:// preferred for events, https:// also works)
 *   KEEPER_PK       - Keeper wallet private key
 *   STRATEGY_ADDRS  - Optional comma-separated strategy addresses
 *   VAULT_ADDRS     - Optional comma-separated vault addresses aligned with STRATEGY_ADDRS
 *   POOL_ADDRS      - Optional comma-separated pool addresses aligned with STRATEGY_ADDRS
 *   POLL_MS         - Fallback poll interval in ms (default: 30000)
 *   COMPOUND_MS     - Compound interval in ms (default: 3600000)
 *   MAX_GAS_GWEI    - Skip a tx if network gas price exceeds this (default: 50)
 */

import { ethers } from 'ethers';
import { DEPLOYED_CONTRACTS } from '../src/data/deployedContracts';

const RPC_URL      = process.env.RPC_URL ?? 'https://rpc.test.mezo.org';
const KEEPER_PK    = process.env.KEEPER_PK ?? '';
const POLL_MS      = parseInt(process.env.POLL_MS     ?? '30000', 10);
const COMPOUND_MS  = parseInt(process.env.COMPOUND_MS ?? `${60 * 60 * 1000}`, 10);
const MAX_GAS_GWEI = process.env.MAX_GAS_GWEI ?? '50';
const MAX_GAS_PRICE = ethers.parseUnits(MAX_GAS_GWEI, 'gwei');

const PROVIDER_RESET_AFTER = 8;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// keccak256("KEEPER_ROLE")
const KEEPER_ROLE_HASH = ethers.keccak256(ethers.toUtf8Bytes('KEEPER_ROLE'));

// Uniswap V3 Swap event topic (same as UniRange CRE logTrigger)
// keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

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

// Minimal pool ABI — just enough to subscribe to Swap events
const POOL_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
];

interface WatchedVault {
  label: string;
  strategy: string;
  vault: string;
  pool: string;
}

interface KeeperState {
  consecutiveFailures: number;
  totalRebalances: number;
  totalCompounds: number;
  lastRebalanceAt: number;
  lastCompoundAt: number;
  nextAttemptAt: number;
  // Deduplicate rapid swap events — only one check per block
  lastSwapCheckBlock: number;
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
  console.error(`${ts()} [${label}] ERROR: ${msg}`);
}

function configuredVaults(): WatchedVault[] {
  const envStrategies = (process.env.STRATEGY_ADDRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const envVaults     = (process.env.VAULT_ADDRS    ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const envPools      = (process.env.POOL_ADDRS     ?? '').split(',').map((v) => v.trim()).filter(Boolean);

  if (envStrategies.length > 0) {
    return envStrategies.map((strategy, i) => ({
      label: `env-${i + 1}`,
      strategy,
      vault: envVaults[i] ?? '',
      pool:  envPools[i]  ?? '',
    }));
  }

  const d = DEPLOYED_CONTRACTS.testnet.vaults;
  return [
    { label: 'btc-musd-50',   strategy: d.btcMusd.strategy,   vault: d.btcMusd.vault,   pool: d.btcMusd.pool   },
    { label: 'mezo-musd-200', strategy: d.mezoMusd.strategy,  vault: d.mezoMusd.vault,  pool: d.mezoMusd.pool  },
    { label: 'btc-musd-10',   strategy: d.btcMusd10.strategy, vault: d.btcMusd10.vault, pool: d.btcMusd10.pool },
  ];
}

function isNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ['timeout','network','temporarily unavailable','socket hang up',
          'econnreset','econnrefused','enotfound','fetch failed'].some((f) => msg.includes(f));
}

function isRetryableError(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ['nonce','underpriced','replacement fee too low'].some((f) => msg.includes(f));
}

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

  const gasEstimate = await provider.estimateGas({ ...txRequest, from: signer.address });

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

async function preflight(rt: Runtime, watched: WatchedVault[]): Promise<void> {
  logInfo('preflight', `keeper=${rt.signer.address}`);
  const bal = await rt.provider.getBalance(rt.signer.address);
  logInfo('preflight', `keeper native balance: ${ethers.formatEther(bal)}`);
  if (bal === 0n) throw new Error('Keeper has zero native balance — top up before running');

  for (const v of watched) {
    const strat = new ethers.Contract(v.strategy, STRATEGY_ABI, rt.provider);
    if (!await strat.hasRole(KEEPER_ROLE_HASH, rt.signer.address)) {
      throw new Error(`[${v.label}] strategy ${v.strategy} missing KEEPER_ROLE for ${rt.signer.address}`);
    }
    if (v.vault) {
      const vault = new ethers.Contract(v.vault, VAULT_ABI, rt.provider);
      if (!await vault.hasRole(KEEPER_ROLE_HASH, rt.signer.address)) {
        throw new Error(`[${v.label}] vault ${v.vault} missing KEEPER_ROLE for ${rt.signer.address}`);
      }
    }
    logInfo('preflight', `${v.label}: KEEPER_ROLE ✓`);
  }
}

/**
 * Core work unit: check one vault and act if needed.
 * Called both from the Swap event handler and the fallback poll loop.
 */
async function checkAndAct(rt: Runtime, watched: WatchedVault, trigger: 'swap-event' | 'poll'): Promise<void> {
  const vs = state[watched.strategy];
  if (Date.now() < vs.nextAttemptAt) return;

  const strategy = new ethers.Contract(watched.strategy, STRATEGY_ABI, rt.provider);
  const vault    = watched.vault ? new ethers.Contract(watched.vault, VAULT_ABI, rt.provider) : null;

  try {
    if (await strategy.paused()) {
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      return;
    }

    const [positionActive, needsRebalance, lower, upper] = await Promise.all([
      strategy.positionActive(),
      strategy.shouldRebalance(),
      strategy.currentTickLower(),
      strategy.currentTickUpper(),
    ]);

    if (positionActive && needsRebalance) {
      logInfo(watched.label, `[${trigger}] rebalance triggered (range [${lower}, ${upper}])`);
      const receipt = await sendManagedTx(strategy.connect(rt.signer) as ethers.Contract, 'rebalance', rt.signer, watched.label);
      if (receipt?.status !== 1n) throw new Error('rebalance tx reverted');
      vs.totalRebalances += 1;
      vs.lastRebalanceAt = Date.now();
      vs.consecutiveFailures = 0;
      vs.nextAttemptAt = 0;
      logInfo(watched.label, `rebalance #${vs.totalRebalances} confirmed in block ${receipt.blockNumber}`);
      return;
    }

    // Only compound on poll cycles to avoid redundant hourly calls from swap events
    if (trigger === 'poll' && vault && !await vault.paused()) {
      if (positionActive && Date.now() - vs.lastCompoundAt >= COMPOUND_MS) {
        logInfo(watched.label, 'compoundFees due');
        const receipt = await sendManagedTx(vault.connect(rt.signer) as ethers.Contract, 'compoundFees', rt.signer, watched.label);
        if (receipt?.status !== 1n) throw new Error('compoundFees tx reverted');
        vs.totalCompounds += 1;
        vs.lastCompoundAt = Date.now();
        vs.consecutiveFailures = 0;
        vs.nextAttemptAt = 0;
      }
    }

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
      logErr(watched.label, 'non-retryable — manual attention may be required');
    }
  }
}

/**
 * Subscribe to Swap events on each pool.
 * On every swap, decode the tick from the event and check shouldRebalance() once per block.
 * This mirrors the Chainlink CRE logTrigger pattern used by UniRange.
 */
function attachSwapListeners(rt: Runtime, watched: WatchedVault[]): ethers.Contract[] {
  const listeners: ethers.Contract[] = [];

  for (const v of watched) {
    if (!v.pool) continue;

    const poolContract = new ethers.Contract(v.pool, POOL_ABI, rt.provider);
    listeners.push(poolContract);

    poolContract.on('Swap', async (_sender, _recipient, _amt0, _amt1, sqrtPriceX96, _liq, tick, event) => {
      const vs = state[v.strategy];
      const blockNumber = event?.log?.blockNumber ?? 0;

      // Deduplicate: only one check per block per vault (a single block may emit many swaps)
      if (blockNumber && blockNumber === vs.lastSwapCheckBlock) return;
      vs.lastSwapCheckBlock = blockNumber;

      logInfo(v.label, `Swap event at block ${blockNumber} tick=${tick} sqrtPrice=${sqrtPriceX96}`);
      await checkAndAct(rt, v, 'swap-event');
    });

    logInfo('events', `listening to Swap events on pool ${v.pool} for ${v.label}`);
  }

  return listeners;
}

function removeSwapListeners(listeners: ethers.Contract[]): void {
  for (const contract of listeners) {
    contract.removeAllListeners('Swap');
  }
}

function createRuntime(): Runtime {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(KEEPER_PK, provider);
  return { provider, signer, networkFailures: 0 };
}

async function main() {
  if (!KEEPER_PK) { logErr('boot', 'KEEPER_PK not set'); process.exit(1); }

  const watchedVaults = configuredVaults().filter((v) => v.strategy);
  if (watchedVaults.length === 0) { logErr('boot', 'No strategy addresses configured'); process.exit(1); }

  let rt = createRuntime();

  for (const v of watchedVaults) {
    state[v.strategy] = {
      consecutiveFailures: 0,
      totalRebalances: 0,
      totalCompounds: 0,
      lastRebalanceAt: 0,
      lastCompoundAt: 0,
      nextAttemptAt: 0,
      lastSwapCheckBlock: 0,
    };
  }

  logInfo('boot', `keeper=${rt.signer.address} rpc=${RPC_URL}`);
  logInfo('boot', `watching ${watchedVaults.length} vaults | poll=${POLL_MS}ms | compound=${COMPOUND_MS}ms`);

  try {
    await preflight(rt, watchedVaults);
  } catch (err) {
    logErr('preflight', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  process.on('SIGINT',  () => { if (!stopping) { stopping = true; logInfo('shutdown', 'SIGINT received'); } });
  process.on('SIGTERM', () => { if (!stopping) { stopping = true; logInfo('shutdown', 'SIGTERM received'); } });

  // Attach Swap event listeners (primary trigger — UniRange/Chainlink CRE style)
  let swapListeners = attachSwapListeners(rt, watchedVaults);

  let cycle = 0;
  while (!stopping) {
    cycle += 1;

    if (cycle % 5 === 0) {
      const summary = watchedVaults
        .map((w) => {
          const s = state[w.strategy];
          return `${w.label}=R${s.totalRebalances}/C${s.totalCompounds}/F${s.consecutiveFailures}`;
        })
        .join(' ');
      logInfo('heartbeat', `cycle=${cycle} ${summary}`);
    }

    // Fallback poll — catches anything missed if event listener drops
    await Promise.allSettled(watchedVaults.map((v) => checkAndAct(rt, v, 'poll')));

    // Cycle provider on repeated network failures, re-attach listeners
    if (rt.networkFailures >= PROVIDER_RESET_AFTER) {
      logErr('runtime', `${rt.networkFailures} network failures — reconnecting provider`);
      removeSwapListeners(swapListeners);
      try { rt.provider.destroy?.(); } catch { /* best-effort */ }
      rt = createRuntime();
      rt.networkFailures = 0;
      swapListeners = attachSwapListeners(rt, watchedVaults);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  removeSwapListeners(swapListeners);
  logInfo('shutdown', 'goodbye');
  process.exit(0);
}

main().catch((error) => {
  logErr('fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
