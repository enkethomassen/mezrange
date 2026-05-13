/**
 * useRedeem — vault redeemWithMinAssets flow.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { VAULT_ABI } from '../abis/MezRangeVault.abi';
import { decodeRevert } from './decodeRevert';

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
      const err = new Error(decodeRevert(e));
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
      const err = new Error(decodeRevert(e));
      setError(err);
      throw err;
    }
  }, [vaultAddress, decimals, writeContractAsync, publicClient]);

  return { redeem, isRedeeming, waitingForTx, txHash, error };
}
