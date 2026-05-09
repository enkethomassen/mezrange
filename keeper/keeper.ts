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
 */

import { ethers } from 'ethers';
import { DEPLOYED_CONTRACTS } from '../src/data/deployedContracts';

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.test.mezo.org';
const KEEPER_PK = process.env.KEEPER_PK ?? '';
const POLL_MS = parseInt(process.env.POLL_MS ?? '12000', 10);
const COMPOUND_MS = parseInt(process.env.COMPOUND_MS ?? `${60 * 60 * 1000}`, 10);
const MAX_GAS_GWEI = process.env.MAX_GAS_GWEI ?? '50';
const MAX_GAS_PRICE = ethers.parseUnits(MAX_GAS_GWEI, 'gwei');

const STRATEGY_ABI = [
  'function shouldRebalance() external view returns (bool)',
  'function rebalance() external',
  'function rebalanceCount() external view returns (uint256)',
  'function currentTickLower() external view returns (int24)',
  'function currentTickUpper() external view returns (int24)',
  'function positionActive() external view returns (bool)',
];

const VAULT_ABI = [
  'function compoundFees() external',
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

const state: Record<string, KeeperState> = {};

function configuredVaults(): WatchedVault[] {
  const envStrategies = (process.env.STRATEGY_ADDRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const envVaults = (process.env.VAULT_ADDRS ?? '').split(',').map((v) => v.trim()).filter(Boolean);

  if (envStrategies.length > 0) {
    return envStrategies.map((strategy, index) => ({
      label: `env-${index + 1}`,
      strategy,
      vault: envVaults[index] ?? '',
    }));
  }

  const defaults = DEPLOYED_CONTRACTS.testnet.vaults;
  return [
    { label: 'btc-musd-50', strategy: defaults.btcMusd.strategy, vault: defaults.btcMusd.vault },
    { label: 'mezo-musd-200', strategy: defaults.mezoMusd.strategy, vault: defaults.mezoMusd.vault },
    { label: 'btc-musd-10', strategy: defaults.btcMezo.strategy, vault: defaults.btcMezo.vault },
  ];
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    'timeout',
    'network',
    'nonce',
    'underpriced',
    'replacement fee too low',
    'temporarily unavailable',
    'socket hang up',
  ].some((fragment) => message.includes(fragment));
}

async function buildTxRequest(
  contract: ethers.Contract,
  method: 'rebalance' | 'compoundFees',
  signer: ethers.Wallet,
): Promise<ethers.TransactionRequest> {
  const provider = signer.provider;
  if (!provider) {
    throw new Error('Signer provider unavailable');
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? MAX_GAS_PRICE;
  if (gasPrice > MAX_GAS_PRICE) {
    throw new Error(`Gas too high (${ethers.formatUnits(gasPrice, 'gwei')} gwei)`);
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
): Promise<ethers.TransactionReceipt | null> {
  const request = await buildTxRequest(contract, method, signer);
  const response = await signer.sendTransaction(request);
  console.log(`[${method}] tx sent: ${response.hash}`);
  return response.wait();
}

async function runKeeperCycle(
  watched: WatchedVault,
  signer: ethers.Wallet,
): Promise<void> {
  const strategy = new ethers.Contract(watched.strategy, STRATEGY_ABI, signer.provider);
  const vault = watched.vault ? new ethers.Contract(watched.vault, VAULT_ABI, signer.provider) : null;
  const vaultState = state[watched.strategy];

  if (Date.now() < vaultState.nextAttemptAt) {
    return;
  }

  try {
    const [positionActive, needsRebalance, lower, upper] = await Promise.all([
      strategy.positionActive(),
      strategy.shouldRebalance(),
      strategy.currentTickLower(),
      strategy.currentTickUpper(),
    ]);

    if (positionActive && needsRebalance) {
      console.log(`[${watched.label}] rebalance triggered for [${lower}, ${upper}]`);
      const receipt = await sendManagedTx(strategy.connect(signer), 'rebalance', signer);
      if (receipt?.status !== 1n) {
        throw new Error('rebalance transaction reverted');
      }
      vaultState.totalRebalances += 1;
      vaultState.lastRebalanceAt = Date.now();
      vaultState.consecutiveFailures = 0;
      vaultState.nextAttemptAt = 0;
      return;
    }

    if (!vault) {
      return;
    }

    const compoundDue = Date.now() - vaultState.lastCompoundAt >= COMPOUND_MS;
    if (!positionActive || !compoundDue) {
      vaultState.consecutiveFailures = 0;
      vaultState.nextAttemptAt = 0;
      return;
    }

    console.log(`[${watched.label}] compoundFees due`);
    const receipt = await sendManagedTx(vault.connect(signer), 'compoundFees', signer);
    if (receipt?.status !== 1n) {
      throw new Error('compoundFees transaction reverted');
    }
    vaultState.totalCompounds += 1;
    vaultState.lastCompoundAt = Date.now();
    vaultState.consecutiveFailures = 0;
    vaultState.nextAttemptAt = 0;
  } catch (error) {
    vaultState.consecutiveFailures += 1;
    const backoffMs = Math.min(POLL_MS * (2 ** Math.min(vaultState.consecutiveFailures, 6)), 5 * 60 * 1000);
    vaultState.nextAttemptAt = Date.now() + backoffMs;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${watched.label}] ${message}`);
    if (!isRetryableError(error)) {
      console.error(`[${watched.label}] non-retryable error, keeping backoff but operator attention is required`);
    }
  }
}

async function main() {
  if (!KEEPER_PK) {
    console.error('KEEPER_PK not set');
    process.exit(1);
  }

  const watchedVaults = configuredVaults().filter((vault) => vault.strategy);
  if (watchedVaults.length === 0) {
    console.error('No strategy addresses configured');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(KEEPER_PK, provider);

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

  console.log(`Keeper address: ${signer.address}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Watching ${watchedVaults.length} vaults`);
  console.log(`Poll interval: ${POLL_MS}ms`);
  console.log(`Compound interval: ${COMPOUND_MS}ms`);

  let cycle = 0;
  while (true) {
    cycle += 1;
    if (cycle % 10 === 0) {
      console.log(`\n[cycle ${cycle}]`);
      for (const watched of watchedVaults) {
        const vaultState = state[watched.strategy];
        console.log(
          `${watched.label} | rebalances=${vaultState.totalRebalances} | compounds=${vaultState.totalCompounds} | failures=${vaultState.consecutiveFailures}`,
        );
      }
    }

    await Promise.allSettled(watchedVaults.map((watched) => runKeeperCycle(watched, signer)));
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error('Fatal keeper error:', error);
  process.exit(1);
});
