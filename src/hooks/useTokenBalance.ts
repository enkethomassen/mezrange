/**
 * useTokenBalance — reads ERC-20 balance and vault allowance for the connected wallet.
 * Refreshes every block (~12 s on Mezo).
 */
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { ERC20_ABI } from '../abis/ERC20.abi';
import { isDeployed } from '../data/deployedContracts';

export interface TokenBalanceData {
  balanceRaw: bigint;
  allowanceRaw: bigint;
  balanceHuman: number;
  allowanceHuman: number;
  isLoading: boolean;
}

const ZERO: TokenBalanceData = {
  balanceRaw: 0n,
  allowanceRaw: 0n,
  balanceHuman: 0,
  allowanceHuman: 0,
  isLoading: false,
};

export function useTokenBalance(
  tokenAddress: string,
  walletAddress: string | undefined,
  spenderAddress: string,
  decimals = 18,
): TokenBalanceData {
  const enabled =
    !!walletAddress &&
    isDeployed(tokenAddress) &&
    isDeployed(spenderAddress);

  const { data, isLoading } = useReadContracts({
    contracts: enabled
      ? [
          {
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf' as const,
            args: [walletAddress as `0x${string}`],
          },
          {
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'allowance' as const,
            args: [walletAddress as `0x${string}`, spenderAddress as `0x${string}`],
          },
        ]
      : [],
    query: { enabled, refetchInterval: 12_000 },
  });

  if (!enabled) return ZERO;
  if (!data || isLoading) return { ...ZERO, isLoading: true };

  const balanceRaw   = (data[0]?.result as bigint | undefined) ?? 0n;
  const allowanceRaw = (data[1]?.result as bigint | undefined) ?? 0n;

  return {
    balanceRaw,
    allowanceRaw,
    balanceHuman:   parseFloat(formatUnits(balanceRaw,   decimals)),
    allowanceHuman: parseFloat(formatUnits(allowanceRaw, decimals)),
    isLoading: false,
  };
}
