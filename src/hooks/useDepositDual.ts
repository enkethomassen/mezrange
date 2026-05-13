/**
 * useDepositDual — ERC-20 approve (both token0 + token1) + vault depositDual flow.
 *
 * depositDual(amount0, amount1, minShares) lets a user provide MUSD (token0) and
 * token1 (MEZO / BTC) directly so the strategy skips its internal pool.swap().
 * This is the recommended path on Mezo testnet where the native token precompile
 * has a recursive transferFrom() bug that makes any swap-based deposit revert.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { VAULT_ABI } from '../abis/MezRangeVault.abi';
import { ERC20_ABI } from '../abis/ERC20.abi';
import { decodeRevert } from './decodeRevert';

export function useDepositDual(
  vaultAddress: string,
  token0Address: string,
  token1Address: string,
  decimals0 = 18,
  decimals1 = 18,
) {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError]   = useState<Error | undefined>();
  const publicClient = usePublicClient();

  const { writeContractAsync: approveAsync, isPending: isApprovingToken0 } = useWriteContract();
  const { writeContractAsync: approve1Async, isPending: isApprovingToken1 } = useWriteContract();
  const { writeContractAsync: depositAsync, isPending: isDepositing } = useWriteContract();

  const { isLoading: waitingForTx } = useWaitForTransactionReceipt({ hash: txHash });

  const isApproving = isApprovingToken0 || isApprovingToken1;

  const depositDual = useCallback(async (
    userAddress: `0x${string}`,
    amount0Human: string,
    amount1Human: string,
  ) => {
    setError(undefined);
    if (!publicClient) throw new Error('Public client unavailable');

    const amount0 = parseUnits(amount0Human || '0', decimals0);
    const amount1 = parseUnits(amount1Human || '0', decimals1);

    if (amount0 === 0n && amount1 === 0n) {
      const err = new Error('Enter at least one token amount');
      setError(err);
      throw err;
    }

    // ── 1. Balance checks ───────────────────────────────────────────────────
    if (amount0 > 0n) {
      const bal0 = await publicClient.readContract({
        address: token0Address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      if (bal0 < amount0) {
        const err = new Error(
          `Insufficient MUSD balance. Wallet: ${formatUnits(bal0, decimals0)} · Required: ${amount0Human}`
        );
        setError(err);
        throw err;
      }
    }

    if (amount1 > 0n && token1Address) {
      const bal1 = await publicClient.readContract({
        address: token1Address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      if (bal1 < amount1) {
        const err = new Error(
          `Insufficient token1 balance. Wallet: ${formatUnits(bal1, decimals1)} · Required: ${amount1Human}`
        );
        setError(err);
        throw err;
      }
    }

    // ── 2. Approve token0 (MUSD) if needed ──────────────────────────────────
    if (amount0 > 0n) {
      const allowance0 = await publicClient.readContract({
        address: token0Address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, vaultAddress as `0x${string}`],
      }) as bigint;

      if (allowance0 < amount0) {
        try {
          const approveTx = await approveAsync({
            address: token0Address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [vaultAddress as `0x${string}`, amount0],
          });
          setTxHash(approveTx);
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        } catch (e) {
          const err = new Error(decodeRevert(e));
          setError(err);
          throw err;
        }
      }
    }

    // ── 3. Approve token1 (MEZO/BTC) if needed ──────────────────────────────
    if (amount1 > 0n && token1Address) {
      const allowance1 = await publicClient.readContract({
        address: token1Address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, vaultAddress as `0x${string}`],
      }) as bigint;

      if (allowance1 < amount1) {
        try {
          const approveTx = await approve1Async({
            address: token1Address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [vaultAddress as `0x${string}`, amount1],
          });
          setTxHash(approveTx);
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        } catch (e) {
          const err = new Error(decodeRevert(e));
          setError(err);
          throw err;
        }
      }
    }

    // ── 4. Execute depositDual ───────────────────────────────────────────────
    try {
      const depositTx = await depositAsync({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'depositDual',
        args: [amount0, amount1, 0n],
      });
      setTxHash(depositTx);
      return depositTx;
    } catch (e) {
      const err = new Error(decodeRevert(e));
      setError(err);
      throw err;
    }
  }, [vaultAddress, token0Address, token1Address, decimals0, decimals1, approveAsync, approve1Async, depositAsync, publicClient]);

  return { depositDual, isApproving, isDepositing, waitingForTx, txHash, error };
}
