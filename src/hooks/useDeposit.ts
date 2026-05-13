/**
 * useDeposit — ERC-20 approve + vault depositWithMinShares flow.
 * Returns { deposit, isApproving, isDepositing, error }.
 *
 * Safety guarantees (prevent the keeper-wallet-empty-balance failure):
 *  1. Reads wallet token balance before attempting anything.
 *  2. Throws a human-readable error if balance < amount.
 *  3. Runs publicClient.simulateContract() before the actual depositWithMinShares write
 *     so any on-chain revert is caught before gas is spent.
 *  4. Decodes OZ v5 custom errors into readable messages.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { VAULT_ABI } from '../abis/MezRangeVault.abi';
import { ERC20_ABI } from '../abis/ERC20.abi';
import { decodeRevert } from './decodeRevert';

export function useDeposit(
  vaultAddress: string,
  tokenAddress: string,
  decimals = 18,
) {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError]   = useState<Error | undefined>();
  const publicClient = usePublicClient();

  const { writeContractAsync: approveAsync, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: depositAsync, isPending: isDepositing } = useWriteContract();

  const { isLoading: waitingForTx } = useWaitForTransactionReceipt({ hash: txHash });

  const deposit = useCallback(async (
    userAddress: `0x${string}`,
    amountHuman: string,
    slippageBps = 50,
  ) => {
    setError(undefined);
    if (!publicClient) throw new Error('Public client unavailable');

    const amount = parseUnits(amountHuman, decimals);

    // ── 1. Pre-flight: balance check ─────────────────────────────────────────
    const balance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    }) as bigint;

    if (balance < amount) {
      const err = new Error(
        `Insufficient token balance. Wallet balance: ${formatUnits(balance, decimals)}  ·  Required: ${amountHuman}`
      );
      setError(err);
      throw err;
    }

    // ── 2. Approve if needed ─────────────────────────────────────────────────
    const allowance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [userAddress, vaultAddress as `0x${string}`],
    }) as bigint;

    if (allowance < amount) {
      try {
        const approveTx = await approveAsync({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress as `0x${string}`, amount],
        });
        setTxHash(approveTx);
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      } catch (e) {
        const err = new Error(decodeRevert(e));
        setError(err);
        throw err;
      }
    }

    // ── 3. Preview shares ────────────────────────────────────────────────────
    const previewShares = await publicClient.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'previewDeposit',
      args: [amount],
    }) as bigint;
    const minShares = (previewShares * BigInt(10000 - slippageBps)) / BigInt(10000);

    // ── 4. Simulate before writing (catches on-chain reverts without gas cost) ─
    try {
      await publicClient.simulateContract({
        account: userAddress,
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'depositWithMinShares',
        args: [amount, minShares],
      });
    } catch (e) {
      const err = new Error(decodeRevert(e));
      setError(err);
      throw err;
    }

    // ── 5. Execute deposit ───────────────────────────────────────────────────
    try {
      const depositTx = await depositAsync({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'depositWithMinShares',
        args: [amount, minShares],
      });
      setTxHash(depositTx);
      return depositTx;
    } catch (e) {
      const err = new Error(decodeRevert(e));
      setError(err);
      throw err;
    }
  }, [vaultAddress, tokenAddress, decimals, approveAsync, depositAsync, publicClient]);

  return { deposit, isApproving, isDepositing, waitingForTx, txHash, error };
}
