/**
 * Shared revert decoder for MezRangeVault + MezRangeStrategyV2 + OZ ERC20.
 *
 * Maps 4-byte selectors emitted by `eth_call` reverts into human-readable
 * messages. Used by useDeposit and useRedeem so the UI shows the exact guard
 * that tripped instead of a generic "transaction failed".
 */
import { decodeErrorResult, formatUnits, keccak256, toHex } from 'viem';

const ERROR_ABI = [
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'InsufficientShares', inputs: [] },
  { type: 'error', name: 'MaxSlippageExceeded', inputs: [] },
  { type: 'error', name: 'ExceedsMaxDeposit', inputs: [] },
  { type: 'error', name: 'NoPendingChange', inputs: [] },
  { type: 'error', name: 'TimelockNotElapsed', inputs: [] },
  { type: 'error', name: 'PendingChangeExists', inputs: [] },
  { type: 'error', name: 'PoolTooYoung', inputs: [] },
  { type: 'error', name: 'PriceDeviatedFromTwap', inputs: [] },
  { type: 'error', name: 'ZeroLiquidity', inputs: [] },
  { type: 'error', name: 'SlippageExceeded', inputs: [] },
  { type: 'error', name: 'PositionAlreadyActive', inputs: [] },
  { type: 'error', name: 'NoActivePosition', inputs: [] },
  { type: 'error', name: 'NotInRange', inputs: [] },
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender',  type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed',  type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender',   type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed',    type: 'uint256' },
    ],
  },
] as const;

const FRIENDLY: Record<string, (args: readonly unknown[]) => string> = {
  ZeroAmount:               () => 'Amount must be greater than zero.',
  InsufficientShares:       () => 'You do not hold enough vault shares for this redemption.',
  MaxSlippageExceeded:      () => 'Slippage tolerance exceeded — try increasing slippage or reducing amount.',
  ExceedsMaxDeposit:        () => 'Deposit exceeds the vault’s maximum allowed deposit.',
  NoPendingChange:          () => 'No pending admin change to execute.',
  TimelockNotElapsed:       () => 'Admin timelock has not elapsed yet.',
  PendingChangeExists:      () => 'An admin change is already queued — cancel it first.',
  PoolTooYoung:             () => 'The pool is too new (TWAP history is too short). Wait for it to mature.',
  PriceDeviatedFromTwap:    () => 'Spot price has diverged from TWAP — likely manipulation. Try again later.',
  ZeroLiquidity:            () => 'Computed liquidity is zero — amount is too small for current price range.',
  SlippageExceeded:         () => 'Swap output below the TWAP-derived minimum. Wait for price to stabilize.',
  PositionAlreadyActive:    () => 'Position is already active.',
  NoActivePosition:         () => 'No active LP position to operate on.',
  NotInRange:               () => 'Price is still in range — rebalance not required.',
  ERC20InsufficientBalance: (args) => {
    const [, balance, needed] = args as [string, bigint, bigint];
    return `Insufficient token balance. Wallet: ${formatUnits(balance, 18)}  ·  Required: ${formatUnits(needed, 18)}`;
  },
  ERC20InsufficientAllowance: (args) => {
    const [, allowance, needed] = args as [string, bigint, bigint];
    return `Insufficient allowance. Approved: ${formatUnits(allowance, 18)}  ·  Required: ${formatUnits(needed, 18)}`;
  },
};

/// Map of selector → ABI item, computed once at module load.
const SELECTOR_MAP: Record<string, typeof ERROR_ABI[number]> = (() => {
  const m: Record<string, typeof ERROR_ABI[number]> = {};
  for (const item of ERROR_ABI) {
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
    const sel = keccak256(toHex(sig)).slice(0, 10);
    m[sel] = item;
  }
  return m;
})();

export function decodeRevert(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const data: string | undefined =
    e?.cause?.data?.data ??
    e?.cause?.data ??
    e?.data?.data ??
    e?.data ??
    e?.error?.data;

  if (data && typeof data === 'string' && data.length >= 10) {
    const sel = data.slice(0, 10).toLowerCase();
    const abiItem = SELECTOR_MAP[sel];
    if (abiItem) {
      try {
        const decoded = decodeErrorResult({
          abi: [abiItem],
          data: data as `0x${string}`,
        });
        const handler = FRIENDLY[decoded.errorName];
        if (handler) return handler(decoded.args ?? []);
        return decoded.errorName;
      } catch {
        // fall through
      }
    }
    // Error(string)
    if (sel === '0x08c379a0') {
      try {
        const decoded = decodeErrorResult({
          abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }],
          data: data as `0x${string}`,
        });
        return (decoded.args?.[0] as string) ?? 'Transaction reverted';
      } catch { /* ignore */ }
    }
  }

  const msg: string | undefined = e?.shortMessage ?? e?.message;
  if (msg) return msg.replace(/\n[\s\S]*$/, '').trim();
  return 'Transaction failed. Check your inputs and try again.';
}
