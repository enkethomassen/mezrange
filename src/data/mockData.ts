export type StrategyType = 'tight' | 'medium' | 'wide';

export interface Vault {
  id: string;
  name: string;
  pair: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  tvl: number;
  apy: number;
  currentPrice: number;
  lowerBound: number;
  upperBound: number;
  strategy: StrategyType;
  rebalanceCount: number;
  feesEarned: number;
  myDeposit: number;
  myShares: number;
  isInRange: boolean;
  performanceFee: number;
  managementFee: number;
  token0Color: string;
  token1Color: string;
}

export interface RebalanceEvent {
  id: string;
  vaultId: string;
  timestamp: Date;
  txHash: string;
  oldLower: number;
  oldUpper: number;
  newLower: number;
  newUpper: number;
  priceAtRebalance: number;
  feesCollected: number;
  gasUsed: number;
  profit: number;
}

export const VAULTS: Vault[] = [
  {
    id: 'vault-btc-musd',
    name: 'BTC/mUSD Vault',
    pair: 'BTC/mUSD',
    token0: '',
    token1: '',
    token0Symbol: 'MUSD',
    token1Symbol: 'BTC',
    tvl: 0,
    apy: 0,
    currentPrice: 0,
    lowerBound: 0,
    upperBound: 0,
    strategy: 'medium',
    rebalanceCount: 0,
    feesEarned: 0,
    myDeposit: 0,
    myShares: 0,
    isInRange: false,
    performanceFee: 0,
    managementFee: 0,
    token0Color: '#22d3ee',
    token1Color: '#f7931a',
  },
  {
    id: 'vault-mezo-musd',
    name: 'MEZO/mUSD Vault',
    pair: 'MEZO/mUSD',
    token0: '',
    token1: '',
    token0Symbol: 'MUSD',
    token1Symbol: 'MEZO',
    tvl: 0,
    apy: 0,
    currentPrice: 0,
    lowerBound: 0,
    upperBound: 0,
    strategy: 'tight',
    rebalanceCount: 0,
    feesEarned: 0,
    myDeposit: 0,
    myShares: 0,
    isInRange: false,
    performanceFee: 0,
    managementFee: 0,
    token0Color: '#22d3ee',
    token1Color: '#8b5cf6',
  },
  {
    id: 'vault-btc-mezo',
    name: 'BTC/mUSD Vault (10 bps)',
    pair: 'BTC/mUSD (10 bps)',
    token0: '',
    token1: '',
    token0Symbol: 'MUSD',
    token1Symbol: 'BTC',
    tvl: 0,
    apy: 0,
    currentPrice: 0,
    lowerBound: 0,
    upperBound: 0,
    strategy: 'wide',
    rebalanceCount: 0,
    feesEarned: 0,
    myDeposit: 0,
    myShares: 0,
    isInRange: false,
    performanceFee: 0,
    managementFee: 0,
    token0Color: '#22d3ee',
    token1Color: '#f7931a',
  },
];

export function formatCurrency(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(decimals)}`;
}

export function formatAddress(addr: string): string {
  return addr.substring(0, 6) + '...' + addr.slice(-4);
}

export function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
