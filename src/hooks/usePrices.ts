/**
 * usePrices — fetches real market prices for BTC, MEZO, and mUSD.
 * Primary source: CoinGecko public API (no key required).
 * mUSD is always $1 (USD-pegged stablecoin).
 * Falls back to the last successfully fetched live price on error.
 */
import { useState, useEffect, useRef } from 'react';

export interface Prices {
  BTC: number;
  MEZO: number;
  mUSD: number;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

const FALLBACK: Prices = {
  BTC: 0,
  MEZO: 0,
  mUSD: 1,
  isLoading: false,
  lastUpdated: null,
  error: null,
};

// CoinGecko only carries BTC under a stable slug. Mezo is not listed there at audit time,
// so we no longer ask for it — the MEZO USD price is derived from the on-chain pool tick in
// liveData.ts (`tickToHumanPrice`), which is the most accurate source for the live pool anyway.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';

/**
 * Convert a Uniswap V3 tick to the raw price of token1 in terms of token0.
 * price(token1/token0) = 1.0001^tick (assuming equal decimals).
 */
export function tickToPrice(tick: number, token0Decimals = 18, token1Decimals = 18): number {
  const raw = Math.pow(1.0001, tick);
  return raw * Math.pow(10, token0Decimals - token1Decimals);
}

/**
 * Convert ticks to human-readable prices for a vault pair.
 *
 * In every Mezo pool we deploy, MUSD is token0 (its address sorts lower than BTC or MEZO).
 * Uniswap V3 defines price as token1/token0, so for a MUSD/X pool `1.0001^tick` returns
 * X-per-MUSD. The human-readable price the UI wants is the *inverse* (MUSD per X = USD per X),
 * which is `1 / 1.0001^tick`. Ticks for BTC at ~$100k are large NEGATIVE (~-115k),
 * so the inverted price comes out positive and large, as expected.
 */
export function ticksToRange(
  tickLower: number,
  tickUpper: number,
  pair: string,
): { lower: number; upper: number } {
  const lowerInv = Math.pow(1.0001, -tickLower);
  const upperInv = Math.pow(1.0001, -tickUpper);
  // Ticks: tickLower < tickUpper, so after inversion lowerInv > upperInv. Swap for display.
  const lo = Math.min(lowerInv, upperInv);
  const hi = Math.max(lowerInv, upperInv);

  if (pair.includes('BTC') && pair.includes('mUSD')) {
    return { lower: Math.round(lo), upper: Math.round(hi) };
  }
  if (pair.includes('MEZO') && pair.includes('mUSD')) {
    return { lower: parseFloat(lo.toFixed(4)), upper: parseFloat(hi.toFixed(4)) };
  }
  // Fallback (no BTC/MEZO pool is live; kept for completeness)
  return { lower: parseFloat(lo.toFixed(4)), upper: parseFloat(hi.toFixed(4)) };
}

export function usePrices(refetchMs = 30_000): Prices {
  const [prices, setPrices] = useState<Prices>({ ...FALLBACK, isLoading: true });
  const savedRef = useRef<Prices>(FALLBACK);

  const fetchPrices = async () => {
    try {
      const res = await fetch(COINGECKO_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const btc: number = data?.bitcoin?.usd ?? savedRef.current.BTC;

      const next: Prices = {
        BTC: btc,
        // MEZO has no reliable off-chain feed; UI derives it from pool tick.
        MEZO: savedRef.current.MEZO,
        mUSD: 1,
        isLoading: false,
        lastUpdated: new Date(),
        error: null,
      };
      savedRef.current = next;
      setPrices(next);
    } catch (e: unknown) {
      // Keep last known prices, just mark error
      setPrices(prev => ({
        ...prev,
        isLoading: false,
        error: e instanceof Error ? e.message : 'Failed to fetch prices',
      }));
    }
  };

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, refetchMs);
    return () => clearInterval(id);
  }, [refetchMs]);

  return prices;
}
