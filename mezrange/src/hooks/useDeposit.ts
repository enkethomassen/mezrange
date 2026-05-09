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

// ── OZ v5 custom error selectors ──────────────────────────────────────────────
// These are the 4-byte selectors emitted by OpenZeppelin v5 ERC-20.
const OZ_ERRORS: Record<string, (data: `0x${string}`) => string> = {
  // ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)
  '0xe450d38c': (data) => {
    try {
      const payload = data.slice(10);
      const balance = BigInt('0x' + payload.slice(64, 128));
      const needed  = BigInt('0x' + payload.slice(128, 192));
      return `Insufficient token balance. Wallet balance: ${formatUnits(balance, 18)}  ·  Required: ${formatUnits(needed, 18)}`;
    } catch { return 'Insufficient token balance'; }
  },
  // ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)
  '0xfb8f41b2': (data) => {
    try {
      const payload = data.slice(10);
      const allowance = BigInt('0x' + payload.slice(64, 128));
      const needed    = BigInt('0x' + payload.slice(128, 192));
      return `Insufficient allowance. Approved: ${formatUnits(allowance, 18)}  ·  Required: ${formatUnits(needed, 18)}`;
    } catch { return 'Insufficient allowance — please approve first'; }
  },
};

function decodeRevertError(err: unknown): string {
  // wagmi wraps the revert data inside err.cause?.data or err.data
  const data: string | undefined =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any)?.cause?.data ?? (err as any)?.data ?? (err as any)?.error?.data;
  if (data && typeof data === 'string' && data.length >= 10) {
    const sel = data.slice(0, 10).toLowerCase();
    if (OZ_ERRORS[sel]) return OZ_ERRORS[sel](data as `0x${string}`);
  }
  // Generic wagmi / viem message
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg: string | undefined = (err as any)?.shortMessage ?? (err as any)?.message;
  if (msg) {
    // Strip long hex payloads from viem error messages
    return msg.replace(/\n.*$/s, '').trim();
  }
  return 'Transaction failed. Check your balance and try again.';
}

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
        const err = new Error(decodeRevertError(e));
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
      const err = new Error(decodeRevertError(e));
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
      const err = new Error(decodeRevertError(e));
      setError(err);
      throw err;
    }
  }, [vaultAddress, tokenAddress, decimals, approveAsync, depositAsync, publicClient]);

  return { deposit, isApproving, isDepositing, waitingForTx, txHash, error };
}
