/**
 * useProtocolStats — aggregates live on-chain data across all 3 vaults.
 * Returns totals for TVL, rebalance count, fees earned, and per-vault data.
 * Now includes currentPoolTick from each vault's Uniswap V3 pool.
 */
import { useVaultData } from './useVaultData';
import { DEPLOYED_CONTRACTS } from '../data/deployedContracts';
import { useAccount } from 'wagmi';

export interface PerVaultOnChain {
  id: string;
  tvl: number;
  rebalanceCount: number;
  feesEarned: number;
  positionActive: boolean;
  shouldRebalance: boolean;
  currentTickLower: number;
  currentTickUpper: number;
  currentPoolTick: number;
  lastRebalanceTimestamp: number;
  performanceFeeBps: number;
  managementFeeBps: number;
  userShares: number;
  userAssets: number;
  isLoading: boolean;
  isDeployedOnChain: boolean;
}

export interface ProtocolStats {
  totalTVL: number;
  totalRebalances: number;
  totalFeesEarned: number;
  vaults: Record<string, PerVaultOnChain>;
  isLoading: boolean;
  hasLiveData: boolean;
}

export function useProtocolStats(network: 'testnet' | 'mainnet' = 'testnet'): ProtocolStats {
  const { address: walletAddress } = useAccount();
  const contracts = DEPLOYED_CONTRACTS[network];

  const btc = useVaultData(
    contracts.vaults.btcMusd.vault,
    contracts.vaults.btcMusd.strategy,
    walletAddress,
    contracts.vaults.btcMusd.pool,
  );
  const mezo = useVaultData(
    contracts.vaults.mezoMusd.vault,
    contracts.vaults.mezoMusd.strategy,
    walletAddress,
    contracts.vaults.mezoMusd.pool,
  );
  const btcMezo = useVaultData(
    contracts.vaults.btcMezo.vault,
    contracts.vaults.btcMezo.strategy,
    walletAddress,
    contracts.vaults.btcMezo.pool,
  );

  const all = [btc, mezo, btcMezo];
  const isLoading = all.some(d => d.isLoading);
  const hasLiveData = all.some(d => d.isDeployedOnChain);

  const totalTVL = all.reduce((s, d) => s + d.tvl, 0);
  const totalRebalances = all.reduce((s, d) => s + d.rebalanceCount, 0);
  const totalFeesEarned = all.reduce((s, d) => s + d.feesEarnedToken0Equivalent, 0);

  const toVault = (d: typeof btc, id: string): PerVaultOnChain => ({
    id,
    tvl: d.tvl,
    rebalanceCount: d.rebalanceCount,
    feesEarned: d.feesEarnedToken0Equivalent,
    positionActive: d.positionActive,
    shouldRebalance: d.shouldRebalance,
    currentTickLower: d.currentTickLower,
    currentTickUpper: d.currentTickUpper,
    currentPoolTick: d.currentPoolTick,
    lastRebalanceTimestamp: d.lastRebalanceTimestamp,
    performanceFeeBps: d.performanceFeeBps,
    managementFeeBps: d.managementFeeBps,
    userShares: d.userShares,
    userAssets: d.userAssets,
    isLoading: d.isLoading,
    isDeployedOnChain: d.isDeployedOnChain,
  });

  return {
    totalTVL,
    totalRebalances,
    totalFeesEarned,
    vaults: {
      'vault-btc-musd':  toVault(btc,     'vault-btc-musd'),
      'vault-mezo-musd': toVault(mezo,    'vault-mezo-musd'),
      'vault-btc-mezo':  toVault(btcMezo, 'vault-btc-mezo'),
    },
    isLoading,
    hasLiveData,
  };
}
