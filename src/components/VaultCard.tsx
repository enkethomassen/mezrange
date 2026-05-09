import { motion } from 'framer-motion';
import { ArrowRight, RefreshCw, TrendingUp, Shield } from 'lucide-react';
import type { Vault } from '../data/mockData';
import { formatCurrency } from '../data/mockData';
import clsx from 'clsx';

interface VaultCardProps {
  vault: Vault;
  onClick: () => void;
  delay?: number;
}

const strategyColor = {
  tight: 'text-red-400 bg-red-500/10 border-red-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  wide: 'text-green-400 bg-green-500/10 border-green-500/20',
};

export default function VaultCard({ vault, onClick, delay = 0 }: VaultCardProps) {
  const hasRange = vault.currentPrice > 0 && vault.lowerBound > 0 && vault.upperBound > vault.lowerBound;
  const rangePercent = hasRange ? ((vault.currentPrice - vault.lowerBound) / (vault.upperBound - vault.lowerBound)) * 100 : 0;
  const clampedPercent = Math.max(0, Math.min(100, rangePercent));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      onClick={onClick}
      className="glass glass-hover rounded-2xl p-5 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2 border-black/20"
              style={{ background: `linear-gradient(135deg, ${vault.token0Color}, ${vault.token1Color})` }}
            >
              <span className="text-xs font-bold text-white drop-shadow">{vault.token0Symbol[0]}</span>
            </div>
            <div
              className="w-6 h-6 rounded-full absolute -bottom-1 -right-1 flex items-center justify-center text-xs border border-slate-900"
              style={{ background: vault.token1Color }}
            >
              <span className="text-xs font-bold text-white">{vault.token1Symbol[0]}</span>
            </div>
          </div>
          <div>
            <div className="font-semibold text-white">{vault.pair}</div>
            <div className={clsx('text-xs border rounded-full px-2 py-0.5 inline-flex mt-0.5 capitalize', strategyColor[vault.strategy])}>
              {vault.strategy}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-emerald-400 font-bold text-lg">{vault.apy > 0 ? `${vault.apy.toFixed(1)}%` : 'N/A'}</div>
          <div className="text-xs text-slate-500">APY</div>
        </div>
      </div>

      {/* Range bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>{hasRange ? `$${vault.lowerBound.toLocaleString()}` : 'Unavailable'}</span>
          <span className={`font-medium ${vault.isInRange ? 'text-emerald-400' : 'text-red-400'}`}>
            {hasRange ? `$${vault.currentPrice.toLocaleString()}` : 'No live range'}
          </span>
          <span>{hasRange ? `$${vault.upperBound.toLocaleString()}` : 'Unavailable'}</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden relative">
          <div
            className="absolute top-0 left-0 h-full bg-emerald-500/20 border-x border-emerald-500/30"
            style={{ width: '100%' }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all ${vault.isInRange ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' : 'bg-red-400 shadow-red-400/50 shadow-sm'}`}
            style={{ left: `calc(${clampedPercent}% - 6px)` }}
          />
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${vault.isInRange ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-xs ${vault.isInRange ? 'text-emerald-400' : 'text-red-400'}`}>
            {hasRange ? (vault.isInRange ? 'Earning fees' : 'Out of range') : 'Waiting for live range data'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <div className="text-sm font-semibold text-white">{formatCurrency(vault.tvl)}</div>
          <div className="text-xs text-slate-500">TVL</div>
        </div>
        <div className="text-center border-x border-white/5">
          <div className="flex items-center justify-center gap-1 text-sm font-semibold text-white">
            <RefreshCw className="w-3 h-3 text-orange-400" />
            {vault.rebalanceCount}
          </div>
          <div className="text-xs text-slate-500">Rebalances</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-white">{formatCurrency(vault.feesEarned)}</div>
          <div className="text-xs text-slate-500">Fees Earned</div>
        </div>
      </div>

      {/* My position (if any) */}
      {vault.myDeposit > 0 && (
        <div className="flex items-center gap-2 bg-orange-500/5 border border-orange-500/15 rounded-xl px-3 py-2 mb-3">
          <Shield className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-xs text-slate-300">My deposit: <span className="text-orange-400 font-semibold">{formatCurrency(vault.myDeposit)}</span></span>
          <span className="ml-auto text-xs text-slate-500">{vault.myShares} shares</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <TrendingUp className="w-3.5 h-3.5" />
          Deposit asset: {vault.token0Symbol}
        </div>
        <div className="flex items-center gap-1 text-orange-400 text-xs font-medium group">
          Manage <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
}
