/**
 * useVaultData — reads live on-chain data for a single vault+strategy+pool triple.
 * Also reads the current pool tick (slot0) to derive the real current price.
 * Falls back to zero/placeholder values when contracts are not deployed.
 * All reads use wagmi's useReadContracts for batched multicall.
 */
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { VAULT_ABI } from '../abis/MezRangeVault.abi';
import { STRATEGY_ABI } from '../abis/MezRangeStrategy.abi';
import { UNISWAP_V3_POOL_ABI } from '../abis/UniswapV3Pool.abi';
import { isDeployed } from '../data/deployedContracts';

export interface OnChainVaultData {
  tvl: number;           // token0 equivalent, float
  totalSupply: number;   // vault shares, float
  rebalanceCount: number;
  feesEarned0: number;   // token0 accumulated fees
  feesEarned1: number;   // token1 accumulated fees
  feesEarnedToken0Equivalent: number;
  currentTickLower: number;
  currentTickUpper: number;
  currentPoolTick: number; // live pool tick from slot0
  positionActive: boolean;
  shouldRebalance: boolean;
  lastRebalanceTimestamp: number; // unix seconds
  performanceFeeBps: number;
  managementFeeBps: number;
  // User position
  userShares: number;
  userAssets: number;
  // Meta
  isLoading: boolean;
  isDeployedOnChain: boolean;
}

const ZERO_DATA: OnChainVaultData = {
  tvl: 0, totalSupply: 0, rebalanceCount: 0, feesEarned0: 0, feesEarned1: 0,
  feesEarnedToken0Equivalent: 0,
  currentTickLower: 0, currentTickUpper: 0, currentPoolTick: 0, positionActive: false,
  shouldRebalance: false, lastRebalanceTimestamp: 0,
  performanceFeeBps: 1000, managementFeeBps: 100,
  userShares: 0, userAssets: 0,
  isLoading: false, isDeployedOnChain: false,
};

export function useVaultData(
  vaultAddress: string,
  strategyAddress: string,
  userAddress: string | undefined,
  poolAddress: string,
  decimals = 18,
): OnChainVaultData {
  const deployed = isDeployed(vaultAddress) && isDeployed(strategyAddress);
  const poolDeployed = isDeployed(poolAddress);

  const baseContracts = deployed ? [
    // 0: vault totalAssets
    { address: vaultAddress as `0x${string}`, abi: VAULT_ABI, functionName: 'totalAssets' as const },
    // 1: vault totalSupply
    { address: vaultAddress as `0x${string}`, abi: VAULT_ABI, functionName: 'totalSupply' as const },
    // 2: vault performanceFeeBps
    { address: vaultAddress as `0x${string}`, abi: VAULT_ABI, functionName: 'performanceFeeBps' as const },
    // 3: vault managementFeeBps
    { address: vaultAddress as `0x${string}`, abi: VAULT_ABI, functionName: 'managementFeeBps' as const },
    // 4: vault balanceOf(user)
    { address: vaultAddress as `0x${string}`, abi: VAULT_ABI, functionName: 'balanceOf' as const, args: [(userAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`] },
    // 5: strategy rebalanceCount
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'rebalanceCount' as const },
    // 6: strategy totalFeesCollected0
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'totalFeesCollected0' as const },
    // 7: strategy totalFeesCollected1
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'totalFeesCollected1' as const },
    // 8: strategy currentTickLower
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'currentTickLower' as const },
    // 9: strategy currentTickUpper
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'currentTickUpper' as const },
    // 10: strategy positionActive
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'positionActive' as const },
    // 11: strategy shouldRebalance
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'shouldRebalance' as const },
    // 12: strategy lastRebalanceTimestamp
    { address: strategyAddress as `0x${string}`, abi: STRATEGY_ABI, functionName: 'lastRebalanceTimestamp' as const },
  ] as const : [] as const;

  const poolContract = poolDeployed
    ? [{ address: poolAddress as `0x${string}`, abi: UNISWAP_V3_POOL_ABI, functionName: 'slot0' as const }] as const
    : [] as const;

  const { data, isLoading } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: deployed ? [...baseContracts, ...poolContract] as any : [],
    query: { enabled: deployed, refetchInterval: 12_000 }, // refresh every ~1 block
  });

  if (!deployed) return ZERO_DATA;
  if (!data || isLoading) return { ...ZERO_DATA, isLoading: true, isDeployedOnChain: true };

  const get = (i: number) => data[i]?.result;
  const bn  = (i: number) => { const v = get(i); return typeof v === 'bigint' ? v : BigInt(Number(v ?? 0)); };
  const num = (i: number, d = decimals) => parseFloat(formatUnits(bn(i), d));

  const totalAssets  = num(0);
  const totalSupply  = num(1);
  const perfFee      = Number(bn(2));
  const mgmtFee      = Number(bn(3));
  const userShares   = num(4);
  const userAssets   = totalSupply > 0 ? (userShares / totalSupply) * totalAssets : 0;

  // slot0 returns a named object from viem: { sqrtPriceX96, tick, ... }
  let currentPoolTick = 0;
  if (poolDeployed) {
    const slot0 = get(13) as { tick?: unknown } | unknown[] | undefined;
    if (slot0) {
      if (Array.isArray(slot0) && slot0.length >= 2) {
        currentPoolTick = Number(slot0[1]);
      } else if (typeof slot0 === 'object' && slot0 !== null && 'tick' in slot0) {
        currentPoolTick = Number((slot0 as { tick: unknown }).tick);
      }
    }
  }

  const tickPrice = currentPoolTick !== 0 ? Math.pow(1.0001, currentPoolTick) : 0;
  const feesEarned0 = num(6);
  const feesEarned1 = num(7);
  const feesEarnedToken0Equivalent = feesEarned0 + (tickPrice > 0 ? feesEarned1 * tickPrice : 0);

  return {
    tvl:                    totalAssets,
    totalSupply,
    rebalanceCount:         Number(bn(5)),
    feesEarned0,
    feesEarned1,
    feesEarnedToken0Equivalent,
    currentTickLower:       Number(get(8) ?? 0),
    currentTickUpper:       Number(get(9) ?? 0),
    currentPoolTick,
    positionActive:         Boolean(get(10)),
    shouldRebalance:        Boolean(get(11)),
    lastRebalanceTimestamp: Number(bn(12)),
    performanceFeeBps:      perfFee,
    managementFeeBps:       mgmtFee,
    userShares,
    userAssets,
    isLoading:              false,
    isDeployedOnChain:      true,
  };
}
