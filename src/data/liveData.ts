/**
 * liveData.ts — merges on-chain contract data with real market prices
 * to produce the Vault display objects used throughout the UI.
 *
 * Replaces all hardcoded mock values with live data wherever available.
 */
import type { Vault } from './mockData';
import type { PerVaultOnChain } from '../hooks/useProtocolStats';
import type { Prices } from '../hooks/usePrices';
import { ticksToRange } from '../hooks/usePrices';

/**
 * Convert a Uniswap V3 pool tick to a human-readable price for the given pair.
 *
 * In every Mezo pool we deploy, MUSD is token0 (its address sorts lower than BTC or MEZO).
 * Uniswap V3 defines price as token1/token0, so for a MUSD/X pool `1.0001^tick` returns
 * X-per-MUSD. The UI wants USD-per-X, which is the inverse: `1 / 1.0001^tick = 1.0001^-tick`.
 * Ticks for BTC at ~$100k are large NEGATIVE (~-115k); the inverted form produces the
 * expected positive USD price.
 */
export function tickToHumanPrice(tick: number, pair: string): number {
  if (tick === 0) return 0;
  const raw = Math.pow(1.0001, -tick);
  if (pair.includes('BTC') && pair.includes('mUSD')) {
    return Math.round(raw * 100) / 100;
  }
  if (pair.includes('MEZO') && pair.includes('mUSD')) {
    return parseFloat(raw.toFixed(6));
  }
  // Fallback (no BTC/MEZO pool is live)
  return parseFloat(raw.toFixed(4));
}

/** Estimate APY from on-chain fees and TVL (annualised from last rebalance) */
function estimateAPY(
  feesEarned: number,
  tvl: number,
  lastRebalanceTimestamp: number,
): number {
  if (tvl <= 0 || feesEarned <= 0 || lastRebalanceTimestamp <= 0) return 0;
  const elapsedDays = Math.max(1, (Date.now() / 1000 - lastRebalanceTimestamp) / 86400);
  const dailyRate = feesEarned / tvl / elapsedDays;
  return parseFloat((dailyRate * 365 * 100).toFixed(1));
}

/** Static vault metadata (colours, names, strategy labels) */
const VAULT_META: Record<string, {
  name: string;
  pair: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Color: string;
  token1Color: string;
  strategy: 'tight' | 'medium' | 'wide';
  performanceFee: number;
  managementFee: number;
}> = {
  'vault-btc-musd': {
    name: 'BTC/mUSD Vault',
    pair: 'BTC/mUSD',
    token0Symbol: 'MUSD',
    token1Symbol: 'BTC',
    token0Color: '#22d3ee',
    token1Color: '#f7931a',
    strategy: 'medium',
    performanceFee: 10,
    managementFee: 1,
  },
  'vault-mezo-musd': {
    name: 'MEZO/mUSD Vault',
    pair: 'MEZO/mUSD',
    token0Symbol: 'MUSD',
    token1Symbol: 'MEZO',
    token0Color: '#22d3ee',
    token1Color: '#8b5cf6',
    strategy: 'tight',
    performanceFee: 10,
    managementFee: 1,
  },
  'vault-btc-musd-10': {
    name: 'BTC/mUSD Vault (10 bps)',
    pair: 'BTC/mUSD (10 bps)',
    token0Symbol: 'MUSD',
    token1Symbol: 'BTC',
    token0Color: '#22d3ee',
    token1Color: '#f7931a',
    strategy: 'wide',
    performanceFee: 10,
    managementFee: 1,
  },
};

/**
 * Build a Vault display object by merging live on-chain data with real market prices.
 * When on-chain data is not yet loaded or the contract is not deployed, returns the
 * optional `fallback` vault if provided, otherwise returns null.
 */
export function buildLiveVault(
  id: string,
  onChain: PerVaultOnChain,
  prices: Prices,
  fallback?: Vault,
): Vault | null {
  const meta = VAULT_META[id];
  if (!meta) return fallback ?? null;

  // Do not render vault until on-chain data is confirmed live.
  if (!onChain.isDeployedOnChain || onChain.isLoading) return fallback ?? null;

  // TVL: on-chain totalAssets in MUSD (18 dec) — show 0 if empty pool, not mock
  const liveTVL = onChain.tvl;

  // Fees earned (in token0 = MUSD = USD equivalent)
  const liveFeesEarned = onChain.feesEarned;

  // Rebalance count — real value (may be 0 for fresh deployment)
  const liveRebalanceCount = onChain.rebalanceCount;

  // Real range from on-chain ticks — skip if no active position
  let lowerBound = 0;
  let upperBound = 0;
  if (onChain.positionActive && (onChain.currentTickLower !== 0 || onChain.currentTickUpper !== 0)) {
    const range = ticksToRange(onChain.currentTickLower, onChain.currentTickUpper, meta.pair);
    if (range.lower > 0 && range.upper > 0) {
      lowerBound = range.lower;
      upperBound = range.upper;
    }
  }

  // Real current price — only from live sources, never mock
  let currentPrice = 0;
  if (meta.pair.includes('BTC') && meta.pair.includes('mUSD')) {
    currentPrice = prices.BTC > 0 ? prices.BTC : 0;
  } else if (meta.pair.includes('MEZO') && meta.pair.includes('mUSD')) {
    currentPrice = prices.MEZO > 0 ? prices.MEZO : 0;
  } else if (meta.pair === 'BTC/MEZO') {
    const btc = prices.BTC;
    const mezo = prices.MEZO;
    currentPrice = btc > 0 && mezo > 0 ? Math.round(btc / mezo) : 0;
  }
  // Pool tick overrides market price (most accurate for the specific pool)
  if (onChain.currentPoolTick !== 0) {
    const tickPrice = tickToHumanPrice(onChain.currentPoolTick, meta.pair);
    if (tickPrice > 0) currentPrice = tickPrice;
  }

  // Is in range? Only meaningful when position is active and bounds are known
  const isInRange = onChain.positionActive
    && currentPrice > 0
    && lowerBound > 0
    && currentPrice >= lowerBound && currentPrice <= upperBound;

  // APY: estimate from on-chain fees/TVL — 0 if no live history window exists yet
  const apy = estimateAPY(
    liveFeesEarned,
    liveTVL,
    onChain.lastRebalanceTimestamp ?? 0,
  );

  // On-chain fee rates
  const performanceFee = onChain.performanceFeeBps > 0
    ? onChain.performanceFeeBps / 100
    : meta.performanceFee;

  return {
    id,
    name: meta.name,
    pair: meta.pair,
    token0: '',
    token1: '',
    token0Symbol: meta.token0Symbol,
    token1Symbol: meta.token1Symbol,
    tvl: liveTVL,
    apy: isNaN(apy) ? 0 : apy,
    currentPrice,
    lowerBound,
    upperBound,
    strategy: meta.strategy,
    rebalanceCount: liveRebalanceCount,
    feesEarned: liveFeesEarned,
    myDeposit: onChain.userAssets,
    myShares: parseFloat(onChain.userShares.toFixed(0)),
    isInRange,
    performanceFee,
    managementFee: onChain.managementFeeBps > 0 ? onChain.managementFeeBps / 100 : meta.managementFee,
    token0Color: meta.token0Color,
    token1Color: meta.token1Color,
  };
}

export { VAULT_META };
