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

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cmezo&vs_currencies=usd&include_24hr_change=true';

/** Convert ticks to sqrt-based price for Uniswap V3 */
export function tickToPrice(tick: number, token0Decimals = 18, token1Decimals = 18): number {
  const sqrtPrice = Math.pow(1.0001, tick / 2);
  const raw = sqrtPrice * sqrtPrice;
  return raw * Math.pow(10, token0Decimals - token1Decimals);
}

/** Convert ticks to human-readable prices for a vault pair */
export function ticksToRange(
  tickLower: number,
  tickUpper: number,
  pair: string,
): { lower: number; upper: number } {
  // For BTC/mUSD pairs: token0=MUSD(18 dec), token1=BTC(18 dec)
  // price = 1.0001^tick → this gives MUSD per BTC, invert to get BTC price in USD
  if (pair.includes('BTC') && pair.includes('mUSD')) {
    const lowerRaw = Math.pow(1.0001, tickLower);
    const upperRaw = Math.pow(1.0001, tickUpper);
    // Since token0=MUSD, token1=BTC, price = token0/token1 = MUSD/BTC = $/BTC
    return {
      lower: Math.round(lowerRaw),
      upper: Math.round(upperRaw),
    };
  }
  // For MEZO/mUSD: token0=MUSD, token1=MEZO
  if (pair.includes('MEZO') && pair.includes('mUSD')) {
    const lower = Math.pow(1.0001, tickLower);
    const upper = Math.pow(1.0001, tickUpper);
    return { lower: parseFloat(lower.toFixed(4)), upper: parseFloat(upper.toFixed(4)) };
  }
  // For BTC/MEZO: token0=MUSD, token1=BTC, but pool is actually the BTC/MEZO pool
  // express as BTC price in MEZO units
  const lower = Math.pow(1.0001, tickLower);
  const upper = Math.pow(1.0001, tickUpper);
  return { lower: Math.round(lower), upper: Math.round(upper) };
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
      const mezo: number = data?.mezo?.usd ?? savedRef.current.MEZO;

      const next: Prices = {
        BTC: btc,
        MEZO: mezo,
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
