import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ArrowDownToLine, ArrowUpFromLine, RefreshCw, TrendingUp,
  ExternalLink, AlertCircle, CheckCircle2, Loader2, Radio, Wallet, CheckCheck,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { Vault } from '../data/mockData';
import { formatCurrency, timeAgo } from '../data/mockData';
import { DEPLOYED_CONTRACTS, isDeployed, explorerLink } from '../data/deployedContracts';
import { useVaultData } from '../hooks/useVaultData';
import { useDeposit } from '../hooks/useDeposit';
import { useDepositDual } from '../hooks/useDepositDual';
import { useRedeem } from '../hooks/useRedeem';
import { useRebalanceEvents, txExplorerLink } from '../hooks/useRebalanceEvents';
import { useTokenBalance } from '../hooks/useTokenBalance';
import RangeChart from './RangeChart';
import clsx from 'clsx';

function getVaultAddressMap(network: 'testnet' | 'mainnet') {
  const contracts = DEPLOYED_CONTRACTS[network];
  return {
    'vault-btc-musd': {
      vault:    contracts.vaults.btcMusd.vault,
      strategy: contracts.vaults.btcMusd.strategy,
      token0:   contracts.vaults.btcMusd.token0,
      token1:   contracts.vaults.btcMusd.token1,
      pool:     contracts.vaults.btcMusd.pool,
    },
    'vault-mezo-musd': {
      vault:    contracts.vaults.mezoMusd.vault,
      strategy: contracts.vaults.mezoMusd.strategy,
      token0:   contracts.vaults.mezoMusd.token0,
      token1:   contracts.vaults.mezoMusd.token1,
      pool:     contracts.vaults.mezoMusd.pool,
    },
    'vault-btc-musd-10': {
      vault:    contracts.vaults.btcMusd10.vault,
      strategy: contracts.vaults.btcMusd10.strategy,
      token0:   contracts.vaults.btcMusd10.token0,
      token1:   contracts.vaults.btcMusd10.token1,
      pool:     contracts.vaults.btcMusd10.pool,
    },
  } satisfies Record<string, { vault: string; strategy: string; token0: string; token1: string; pool: string }>;
}

interface VaultModalProps {
  vault: Vault | null;
  /** Sibling vaults so the strategy picker can route to a vault that uses the chosen strategy. */
  liveVaults?: Vault[];
  /** Switch the modal to a different vault when the strategy picker selects one. */
  onSelectVault?: (v: Vault) => void;
  onClose: () => void;
  walletAddress: string | undefined;
  isConnected: boolean;
  network?: 'testnet' | 'mainnet';
}

// Each strategy maps to the deployed vault that uses it on-chain. The deposit
// modal's strategy picker switches the selected vault rather than mutating an
// on-chain parameter — strategy is fixed at deploy time in MezRangeStrategyV2.
const strategyConfig = {
  tight:  { label: 'Tight ±3%',  desc: 'High fees, frequent rebalances', color: 'red'   },
  medium: { label: 'Medium ±10%', desc: 'Balanced risk/reward',            color: 'amber' },
  wide:   { label: 'Wide ±30%',  desc: 'Lower fees, fewer rebalances',    color: 'green' },
};

export default function VaultModal({
  vault,
  liveVaults = [],
  onSelectVault,
  onClose,
  walletAddress,
  isConnected,
  network = 'testnet',
}: VaultModalProps) {
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'history'>('deposit');
  const [amount, setAmount] = useState('');
  const [dualMode, setDualMode] = useState(false);
  const [amount1, setAmount1] = useState('');

  const vaultId = (vault?.id ?? 'vault-btc-musd') as 'vault-btc-musd' | 'vault-mezo-musd' | 'vault-btc-musd-10';
  const addrs = getVaultAddressMap(network)[vaultId];
  const contractsDeployed = addrs && isDeployed(addrs.vault);

  // On-chain data hook
  const onChain = useVaultData(
    addrs?.vault    ?? '0x0000000000000000000000000000000000000000',
    addrs?.strategy ?? '0x0000000000000000000000000000000000000000',
    walletAddress,
    addrs?.pool     ?? '0x0000000000000000000000000000000000000000',
  );

  // Live wallet token balance + approval state
  const tokenBalance = useTokenBalance(
    addrs?.token0 ?? '',
    walletAddress,
    addrs?.vault  ?? '',
  );

  // Write hooks
  const { deposit, isApproving, isDepositing, waitingForTx: waitDeposit, txHash: depositTxHash, error: depositErr } = useDeposit(
    addrs?.vault  ?? '',
    addrs?.token0 ?? '',
  );
  const { depositDual, isApproving: isDualApproving, isDepositing: isDualDepositing, waitingForTx: waitDual, txHash: dualTxHash, error: dualErr } = useDepositDual(
    addrs?.vault   ?? '',
    addrs?.token0  ?? '',
    addrs?.token1  ?? '',
  );
  const { redeem, isRedeeming, waitingForTx: waitRedeem, txHash: redeemTxHash, error: redeemErr } = useRedeem(
    addrs?.vault ?? '',
  );

  const isPending = isApproving || isDepositing || waitDeposit || isDualApproving || isDualDepositing || waitDual || isRedeeming || waitRedeem;
  const txHash    = depositTxHash ?? dualTxHash ?? redeemTxHash;
  const txErr     = depositErr ?? dualErr ?? redeemErr;

  // Derived display values (on-chain preferred, zero fallback — no fake data)
  const displayTVL        = contractsDeployed && onChain.tvl > 0 ? onChain.tvl : 0;
  const displayRebalances = contractsDeployed ? onChain.rebalanceCount : 0;
  const displayFeesEarned = contractsDeployed ? onChain.feesEarned0 + onChain.feesEarned1 : 0;
  const displayUserShares = contractsDeployed ? onChain.userShares : 0;
  const displayUserAssets = contractsDeployed ? onChain.userAssets : 0;
  const displayPerfFee    = contractsDeployed ? (onChain.performanceFeeBps / 100) : 0;
  const displayMgmtFee    = contractsDeployed ? (onChain.managementFeeBps  / 100) : 0;

  // Deposit validation helpers
  const amountNum    = parseFloat(amount) || 0;
  const hasBalance   = tokenBalance.balanceHuman >= amountNum && amountNum > 0;
  const hasAllowance = tokenBalance.allowanceHuman >= amountNum && amountNum > 0;
  const needsApprove = isConnected && amountNum > 0 && !hasAllowance && tab === 'deposit';
  const hasShares = displayUserShares >= amountNum && amountNum > 0;

  // Estimated shares for UX preview
  const estShares = (() => {
    if (!amount || amountNum <= 0 || !contractsDeployed) return null;
    const ts = onChain.totalSupply;
    const ta = onChain.tvl;
    if (ts > 0 && ta > 0) return (amountNum / ta) * ts;
    return amountNum; // first depositor: 1:1
  })();
  const estWithdrawAssets = (() => {
    if (!amount || amountNum <= 0 || !contractsDeployed) return null;
    if (displayUserShares <= 0 || displayUserAssets <= 0) return 0;
    return (Math.min(amountNum, displayUserShares) / displayUserShares) * displayUserAssets;
  })();

  // Live on-chain rebalance events
  const { events: allLiveEvents, isLoading: eventsLoading, isLive: eventsLive } = useRebalanceEvents(network);
  const events = allLiveEvents.filter(e => e.vaultId === vaultId);

  if (!vault) return null;

  const handleDeposit = async () => {
    if (!walletAddress || !contractsDeployed) return;
    try {
      if (dualMode) {
        if (!amount && !amount1) return;
        await depositDual(walletAddress as `0x${string}`, amount || '0', amount1 || '0');
        setAmount(''); setAmount1('');
      } else {
        if (!amount) return;
        await deposit(walletAddress as `0x${string}`, amount);
        setAmount('');
      }
    } catch {/* error surfaced via txErr */}
  };

  const handleRedeem = async () => {
    if (!walletAddress || !amount || !contractsDeployed) return;
    try {
      await redeem(walletAddress as `0x${string}`, amount);
      setAmount('');
    } catch {/* error surfaced via txErr */}
  };

  const handleAction = tab === 'deposit' ? handleDeposit : handleRedeem;

  // MAX button: use real on-chain balance
  const handleMax = () => {
    if (tab === 'deposit') {
      if (tokenBalance.balanceHuman > 0) {
        setAmount(formatUnits(tokenBalance.balanceRaw, 18));
      }
    } else {
      if (displayUserShares > 0) {
        setAmount(displayUserShares.toFixed(6));
      }
    }
  };

  // Submit button disability logic
  const amount1Num = parseFloat(amount1) || 0;
  const depositDisabled =
    isPending ||
    !contractsDeployed ||
    (dualMode ? (amountNum <= 0 && amount1Num <= 0) : !amount) ||
    tokenBalance.isLoading ||
    (isConnected && !dualMode && amountNum > 0 && !hasBalance);
  const withdrawDisabled =
    isPending ||
    !contractsDeployed ||
    !amount ||
    amountNum <= 0 ||
    (isConnected && amountNum > 0 && !hasShares);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="glass rounded-3xl w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold"
                style={{ background: `linear-gradient(135deg, ${vault.token0Color}, ${vault.token1Color})` }}
              >
                {vault.token0Symbol[0]}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-xl font-bold text-white">{vault.name}</div>
                  {contractsDeployed ? (
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5">Live</span>
                  ) : (
                    <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5">Pending Deploy</span>
                  )}
                </div>
                <div className="text-sm text-slate-400">{vault.pair} · ERC-4626 Vault</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full glass flex items-center justify-center text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-4 gap-3 p-6 border-b border-white/5">
            {[
              { label: 'TVL',         value: displayTVL > 0         ? formatCurrency(displayTVL)         : '—' },
              { label: 'APY',         value: vault.apy > 0          ? `${vault.apy.toFixed(1)}%`          : '—',   color: 'text-emerald-400' },
              { label: 'Fees Earned', value: displayFeesEarned > 0  ? formatCurrency(displayFeesEarned)  : '—' },
              { label: 'Rebalances',  value: displayRebalances > 0  ? displayRebalances.toString()       : '—' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className={clsx('text-lg font-bold', color ?? 'text-white')}>{value}</div>
                <div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {/* User position */}
          {isConnected && (displayUserShares > 0 || displayUserAssets > 0) && (
            <div className="mx-6 mt-4 glass rounded-xl p-4 border border-orange-500/20 bg-orange-500/5">
              <div className="text-xs text-orange-400 font-semibold mb-2 uppercase tracking-wider">Your Position</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-slate-500 text-xs">Shares</div>
                  <div className="text-white font-semibold">{displayUserShares.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">Value ({vault.token0Symbol})</div>
                  <div className="text-white font-semibold">{displayUserAssets.toFixed(4)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Range chart */}
          <div className="p-6 border-b border-white/5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-white">Price Range (24h)</span>
              {contractsDeployed && onChain.positionActive && (
                <span className="ml-auto text-xs text-emerald-400 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Position Active
                </span>
              )}
              {contractsDeployed && onChain.shouldRebalance && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Rebalance Needed
                </span>
              )}
            </div>
            <RangeChart vault={vault} />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-4 border-b border-white/5">
            {(['deposit', 'withdraw', 'history'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setAmount(''); }}
                className={clsx(
                  'flex-1 py-2 rounded-xl text-sm font-medium transition-all capitalize',
                  tab === t ? 'bg-orange-500 text-black' : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                {t === 'deposit'  && <ArrowDownToLine className="w-3.5 h-3.5 inline mr-1.5" />}
                {t === 'withdraw' && <ArrowUpFromLine  className="w-3.5 h-3.5 inline mr-1.5" />}
                {t === 'history'  && <RefreshCw        className="w-3.5 h-3.5 inline mr-1.5" />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-6">
            {(tab === 'deposit' || tab === 'withdraw') && (
              <div className="space-y-5">
                {/* Not deployed warning */}
                {!contractsDeployed && (
                  <div className="flex items-start gap-3 glass rounded-xl p-4 border border-amber-500/20 bg-amber-500/5">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-300 leading-relaxed">
                      This vault has not been deployed to testnet yet. Transactions are disabled.
                    </div>
                  </div>
                )}

                {/* ── Wallet State Panel ────────────────────────────────────── */}
                {isConnected && contractsDeployed && tab === 'deposit' && (
                  <div className="glass rounded-xl p-4 space-y-2 border border-white/5">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Wallet State</span>
                    </div>

                    {/* Balance row */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{vault.token0Symbol} Balance</span>
                      {tokenBalance.isLoading ? (
                        <span className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading…</span>
                      ) : (
                        <span className={clsx(
                          'font-mono font-medium',
                          amountNum > 0 && tokenBalance.balanceHuman < amountNum
                            ? 'text-red-400'
                            : 'text-white'
                        )}>
                          {tokenBalance.balanceHuman.toLocaleString(undefined, { maximumFractionDigits: 4 })} {vault.token0Symbol}
                        </span>
                      )}
                    </div>

                    {/* Required row — only shown when amount is entered */}
                    {amountNum > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Required</span>
                        <span className="font-mono font-medium text-slate-300">
                          {amountNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} {vault.token0Symbol}
                        </span>
                      </div>
                    )}

                    {/* Approval status */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Approval Status</span>
                      {tokenBalance.isLoading ? (
                        <span className="text-slate-500">—</span>
                      ) : amountNum <= 0 ? (
                        <span className="text-slate-500">Enter amount to check</span>
                      ) : hasAllowance ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCheck className="w-3 h-3" />Approved
                        </span>
                      ) : (
                        <span className="text-amber-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />Needs approval
                        </span>
                      )}
                    </div>

                    {/* Estimated shares */}
                    {amountNum > 0 && estShares !== null && (
                      <div className="flex items-center justify-between text-xs border-t border-white/5 pt-2 mt-1">
                        <span className="text-slate-500">Estimated Shares</span>
                        <span className="font-mono text-orange-400 font-medium">
                          ≈{estShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                    )}

                    {/* Inline balance error */}
                    {isConnected && amountNum > 0 && !hasBalance && !tokenBalance.isLoading && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        Insufficient {vault.token0Symbol} balance. Need {(amountNum - tokenBalance.balanceHuman).toLocaleString(undefined, { maximumFractionDigits: 4 })} more.
                      </div>
                    )}

                    {/* MUSD acquisition hint — shown when wallet has < required MUSD.
                        MUSD on Mezo testnet is not on the BTC/MEZO faucet; users acquire it
                        by opening a Borrow position against BTC collateral on Mezo's CDP UI. */}
                    {isConnected && vault.token0Symbol === 'MUSD' && !tokenBalance.isLoading
                      && (amountNum > 0 ? !hasBalance : tokenBalance.balanceHuman <= 0) && (
                      <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2 mt-1 border border-amber-500/20">
                        <Wallet className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
                        <div className="leading-relaxed">
                          <span className="font-semibold text-amber-200">Need MUSD?</span>{' '}
                          The Mezo faucet only emits BTC and MEZO. Acquire MUSD by opening a
                          Borrow position against BTC collateral.
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                            <a
                              href="https://app.test.mezo.org/borrow"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-200 underline hover:text-amber-100 transition-colors inline-flex items-center gap-1"
                            >
                              Borrow MUSD <ExternalLink className="w-3 h-3" />
                            </a>
                            <a
                              href="https://faucet.test.mezo.org/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-200 underline hover:text-amber-100 transition-colors inline-flex items-center gap-1"
                            >
                              BTC/MEZO faucet <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isConnected && contractsDeployed && tab === 'withdraw' && (
                  <div className="glass rounded-xl p-4 space-y-2 border border-white/5">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vault Position</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Share Balance</span>
                      <span className={clsx(
                        'font-mono font-medium',
                        amountNum > 0 && displayUserShares < amountNum ? 'text-red-400' : 'text-white'
                      )}>
                        {displayUserShares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                      </span>
                    </div>

                    {amountNum > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Required</span>
                        <span className="font-mono font-medium text-slate-300">
                          {amountNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs border-t border-white/5 pt-2 mt-1">
                      <span className="text-slate-500">Estimated Assets</span>
                      <span className="font-mono text-orange-400 font-medium">
                        ≈{(estWithdrawAssets ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} {vault.token0Symbol}
                      </span>
                    </div>

                    {isConnected && amountNum > 0 && !hasShares && (
                      <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        Insufficient vault shares. Need {(amountNum - displayUserShares).toLocaleString(undefined, { maximumFractionDigits: 4 })} more shares.
                      </div>
                    )}
                  </div>
                )}

                {/* Dual-deposit toggle — shown only on deposit tab when connected */}
                {tab === 'deposit' && isConnected && contractsDeployed && (
                  <div className="flex items-center justify-between glass rounded-xl px-4 py-3 border border-white/5">
                    <div>
                      <div className="text-xs font-semibold text-white">Dual Deposit</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Provide {vault.token0Symbol} + {vault.token1Symbol} directly — skips internal swap
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setDualMode(d => !d); setAmount(''); setAmount1(''); }}
                      className={clsx(
                        'relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0',
                        dualMode ? 'bg-orange-500' : 'bg-slate-700'
                      )}
                      style={{ minWidth: '2.5rem', height: '1.375rem' }}
                    >
                      <span
                        className={clsx(
                          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                          dualMode ? 'translate-x-5' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                  </div>
                )}

                {/* Amount input(s) */}
                {dualMode && tab === 'deposit' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 font-medium uppercase tracking-wider block mb-2">
                        {vault.token0Symbol} Amount
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          placeholder="0.00"
                          disabled={!contractsDeployed || !isConnected}
                          className="w-full glass rounded-xl px-4 py-3 text-white text-lg font-semibold placeholder-slate-600 outline-none transition-colors focus:border-orange-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <button
                          onClick={() => { if (tokenBalance.balanceHuman > 0) setAmount(formatUnits(tokenBalance.balanceRaw, 18)); }}
                          disabled={!contractsDeployed || !isConnected}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          MAX
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-medium uppercase tracking-wider block mb-2">
                        {vault.token1Symbol} Amount
                      </label>
                      <input
                        type="number"
                        value={amount1}
                        onChange={e => setAmount1(e.target.value)}
                        placeholder="0.00"
                        disabled={!contractsDeployed || !isConnected}
                        className="w-full glass rounded-xl px-4 py-3 text-white text-lg font-semibold placeholder-slate-600 outline-none transition-colors focus:border-orange-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                      Provide tokens in the current pool ratio for best results. Either amount can be zero.
                    </div>
                  </div>
                ) : (
                <div>
                  <label className="text-xs text-slate-400 font-medium uppercase tracking-wider block mb-2">
                    Amount ({tab === 'withdraw' ? 'Shares' : vault.token0Symbol})
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={!contractsDeployed || !isConnected}
                      className={clsx(
                        'w-full glass rounded-xl px-4 py-3 text-white text-lg font-semibold placeholder-slate-600 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                        isConnected && amountNum > 0 && tab === 'deposit' && !hasBalance
                          ? 'border border-red-500/50 focus:border-red-400/70'
                          : 'focus:border-orange-500/50'
                      )}
                    />
                    <button
                      onClick={handleMax}
                      disabled={!contractsDeployed || !isConnected}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                )}

                {/* Strategy picker — switches the selected vault to whichever
                    deployed vault uses the chosen range strategy on-chain. */}
                {tab === 'deposit' && (
                  <div>
                    <label className="text-xs text-slate-400 font-medium uppercase tracking-wider block mb-2">
                      Strategy
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {(Object.keys(strategyConfig) as Array<keyof typeof strategyConfig>).map((s) => {
                        const cfg = strategyConfig[s];
                        const active = vault.strategy === s;
                        // Find the deployed vault whose StrategyType matches `s`.
                        const target = liveVaults.find(v => v.strategy === s);
                        const canRoute = !!target && !!onSelectVault && target.id !== vault.id;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => { if (canRoute && target && onSelectVault) onSelectVault(target); }}
                            disabled={!target || active}
                            title={target ? `${target.name} (${target.pair})` : 'No deployed vault for this strategy'}
                            className={clsx(
                              'rounded-xl p-3 text-left transition-all border disabled:cursor-not-allowed',
                              active
                                ? 'bg-orange-500/10 border-orange-500/40'
                                : canRoute
                                  ? 'glass border-transparent hover:border-orange-500/30 cursor-pointer'
                                  : 'glass border-transparent opacity-50',
                            )}
                          >
                            <div className="text-xs font-semibold text-white mb-0.5">{cfg.label}</div>
                            <div className="text-xs text-slate-500">{cfg.desc}</div>
                            {target && !active && (
                              <div className="text-[10px] text-orange-400 mt-1 truncate">
                                Switch to {target.pair}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-xs text-slate-500">
                      Each deployed vault has a fixed on-chain range strategy. Picking one routes you to that vault.
                    </div>
                  </div>
                )}

                {/* Fee info */}
                <div className="glass rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Performance Fee</span>
                    <span className="text-white">{displayPerfFee > 0 ? `${displayPerfFee}%` : '—'} of earned fees</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Management Fee</span>
                    <span className="text-white">{displayMgmtFee > 0 ? `${displayMgmtFee}%` : '—'} / year</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Estimated APY</span>
                    <span className="text-emerald-400 font-semibold">
                      {vault.apy > 0 ? `${vault.apy.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>

                {/* Error — decoded human-readable */}
                {txErr && (
                  <div className="flex items-start gap-2 text-xs text-red-400 glass rounded-xl p-3 border border-red-500/20 bg-red-500/5">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="break-words">{(txErr as Error).message ?? 'Transaction failed. Check your balance and try again.'}</span>
                  </div>
                )}

                {/* Tx success */}
                {txHash && !isPending && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 glass rounded-xl p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Transaction confirmed!</span>
                    <a
                      href={explorerLink(txHash, 'tx')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1 hover:text-emerald-300 transition-colors"
                    >
                      View <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {/* CTA */}
                <button
                  onClick={isConnected ? handleAction : undefined}
                  disabled={isConnected ? (tab === 'deposit' ? depositDisabled : withdrawDisabled) : false}
                  className={clsx(
                    'w-full py-3.5 rounded-xl font-semibold text-sm transition-all',
                    !isConnected
                      ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-black hover:from-orange-400 hover:to-amber-400 glow-orange cursor-pointer'
                      : isPending
                        ? 'bg-orange-500/50 text-black cursor-wait'
                        : tab === 'deposit' && isConnected && amountNum > 0 && !hasBalance
                          ? 'bg-red-800/40 text-red-300 cursor-not-allowed'
                          : tab === 'withdraw' && isConnected && amountNum > 0 && !hasShares
                            ? 'bg-red-800/40 text-red-300 cursor-not-allowed'
                          : !contractsDeployed || !amount
                            ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            : needsApprove
                              ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:from-amber-400 hover:to-yellow-400'
                              : 'bg-gradient-to-r from-orange-500 to-amber-500 text-black hover:from-orange-400 hover:to-amber-400 glow-orange'
                  )}
                >
                  {!isConnected ? (
                    <span>Connect Wallet to Continue</span>
                  ) : isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {(isApproving || isDualApproving) ? 'Approving…' : tab === 'deposit' ? 'Depositing…' : 'Withdrawing…'}
                    </span>
                  ) : tab === 'deposit' && isConnected && amountNum > 0 && !hasBalance ? (
                    <span className="flex items-center justify-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Insufficient {vault.token0Symbol} Balance
                    </span>
                  ) : tab === 'withdraw' && isConnected && amountNum > 0 && !hasShares ? (
                    <span className="flex items-center justify-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Insufficient Vault Shares
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      {tab === 'deposit' ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
                      {tab === 'deposit' && dualMode
                        ? `Deposit ${vault.token0Symbol} + ${vault.token1Symbol}`
                        : needsApprove
                          ? `Approve ${vault.token0Symbol}`
                          : tab === 'deposit'
                            ? `Deposit ${vault.token0Symbol}`
                            : `Withdraw ${vault.token0Symbol}`}
                    </span>
                  )}
                </button>
              </div>
            )}

            {tab === 'history' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">
                  <span>{events.length} Rebalances</span>
                  {eventsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  {eventsLive && (
                    <span className="flex items-center gap-1 text-emerald-400 normal-case font-normal">
                      <Radio className="w-3 h-3" />Live on-chain
                    </span>
                  )}
                </div>

                {eventsLoading ? (
                  <div className="text-center text-slate-500 py-8 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />Fetching events…
                  </div>
                ) : events.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    <RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-30" />
                    No rebalances executed yet
                  </div>
                ) : (
                  events.map(ev => (
                    <div key={ev.id} className="glass rounded-xl p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5 text-orange-400" />
                          <span className="text-sm font-medium text-white">Rebalanced</span>
                        </div>
                        <span className="text-xs text-slate-500">{timeAgo(ev.timestamp)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block">Old Range</span>
                          <span className="text-slate-300">{ev.oldLower.toLocaleString()} – {ev.oldUpper.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">New Range</span>
                          <span className="text-emerald-400">{ev.newLower.toLocaleString()} – {ev.newUpper.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Fees Collected</span>
                          <span className="text-white">${ev.feesCollected.toFixed(4)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Tx</span>
                          <a
                            href={eventsLive ? txExplorerLink(ev.txHash, network) : explorerLink(ev.txHash, 'tx')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-400 font-mono hover:text-orange-300 transition-colors flex items-center gap-1"
                          >
                            {ev.txHash.slice(0, 12)}…
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
