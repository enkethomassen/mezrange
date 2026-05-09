/**
 * useRedeem — vault redeemWithMinAssets flow.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { VAULT_ABI } from '../abis/MezRangeVault.abi';

const VAULT_ERRORS: Record<string, (data: `0x${string}`) => string> = {
  // InsufficientShares()
  '0x356680b7': () => 'Insufficient vault shares for this withdrawal',
};

const OZ_ERRORS: Record<string, (data: `0x${string}`) => string> = {
  // ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)
  '0xe450d38c': (data) => {
    try {
      const payload = data.slice(10);
      const balance = BigInt('0x' + payload.slice(64, 128));
      const needed = BigInt('0x' + payload.slice(128, 192));
      return `Insufficient balance. Current: ${formatUnits(balance, 18)}  ·  Required: ${formatUnits(needed, 18)}`;
    } catch { return 'Insufficient balance'; }
  },
};

function decodeRevertError(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: string | undefined = (err as any)?.cause?.data ?? (err as any)?.data ?? (err as any)?.error?.data;
  if (data && typeof data === 'string' && data.length >= 10) {
    const selector = data.slice(0, 10).toLowerCase();
    if (VAULT_ERRORS[selector]) return VAULT_ERRORS[selector](data as `0x${string}`);
    if (OZ_ERRORS[selector]) return OZ_ERRORS[selector](data as `0x${string}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg: string | undefined = (err as any)?.shortMessage ?? (err as any)?.message;
  if (msg) return msg.replace(/\n.*$/s, '').trim();
  return 'Withdrawal failed. Check your share balance and try again.';
}

export function useRedeem(vaultAddress: string, decimals = 18) {
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isRedeeming } = useWriteContract();
  const { isLoading: waitingForTx } = useWaitForTransactionReceipt({ hash: txHash });

  const redeem = useCallback(async (
    userAddress: `0x${string}`,
    sharesHuman: string,
    slippageBps = 50,
  ) => {
    setError(undefined);
    if (!publicClient) {
      throw new Error('Public client unavailable');
    }

    const shares = parseUnits(sharesHuman, decimals);
    const balance = await publicClient.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });

    if (balance < shares) {
      const err = new Error(
        `Insufficient vault shares. Current: ${formatUnits(balance, decimals)}  ·  Required: ${sharesHuman}`
      );
      setError(err);
      throw err;
    }

    const previewAssets = await publicClient.readContract({
      address: vaultAddress as `0x${string}`,
      abi: VAULT_ABI,
      functionName: 'previewRedeem',
      args: [shares],
    });
    const minAssets = (previewAssets * BigInt(10000 - slippageBps)) / BigInt(10000);

    try {
      await publicClient.simulateContract({
        account: userAddress,
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'redeemWithMinAssets',
        args: [shares, minAssets],
      });
    } catch (e) {
      const err = new Error(decodeRevertError(e));
      setError(err);
      throw err;
    }

    try {
      const tx = await writeContractAsync({
        address: vaultAddress as `0x${string}`,
        abi: VAULT_ABI,
        functionName: 'redeemWithMinAssets',
        args: [shares, minAssets],
      });
      setTxHash(tx);
      return tx;
    } catch (e) {
      const err = new Error(decodeRevertError(e));
      setError(err);
      throw err;
    }
  }, [vaultAddress, decimals, writeContractAsync, publicClient]);

  return { redeem, isRedeeming, waitingForTx, txHash, error };
}
