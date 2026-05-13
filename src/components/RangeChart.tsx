import type { Vault } from '../data/mockData';

interface RangeChartProps {
  vault: Vault;
}

export default function RangeChart({ vault }: RangeChartProps) {
  const hasLiveRange = vault.currentPrice > 0 && vault.lowerBound > 0 && vault.upperBound > 0;
  const rangeWidth = hasLiveRange ? Math.max(vault.upperBound - vault.lowerBound, 1) : 1;
  const padding = hasLiveRange ? rangeWidth * 0.25 : 1;
  const scaleMin = hasLiveRange ? Math.max(0, vault.lowerBound - padding) : 0;
  const scaleMax = hasLiveRange ? vault.upperBound + padding : 1;
  const scaleSpan = Math.max(scaleMax - scaleMin, 1);
  const currentOffset = hasLiveRange ? ((vault.currentPrice - scaleMin) / scaleSpan) * 100 : 0;
  const rangeOffset = hasLiveRange ? ((vault.lowerBound - scaleMin) / scaleSpan) * 100 : 0;
  const rangePercent = hasLiveRange ? (rangeWidth / scaleSpan) * 100 : 0;

  if (!hasLiveRange) {
    return (
      <div className="glass rounded-2xl border border-white/5 p-6 text-sm text-slate-400">
        No live range data yet. Deposit liquidity and execute a rebalance to populate the current range.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${vault.isInRange ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${vault.isInRange ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {vault.isInRange ? 'In Range' : 'Out of Range'}
        </div>
        <div className="text-xs text-slate-500">
          Live pool price vs active vault range
        </div>
      </div>

      <div className="relative h-8 rounded-full bg-slate-800 mb-4 overflow-hidden">
        <div
          className="absolute top-0 h-full bg-emerald-500/20 border-x border-emerald-500/40"
          style={{ left: `${rangeOffset}%`, width: `${rangePercent}%` }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 ${vault.isInRange ? 'bg-emerald-400 border-emerald-300' : 'bg-red-400 border-red-300'}`}
          style={{ left: `calc(${Math.max(0, Math.min(100, currentOffset))}% - 8px)` }}
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {scaleMin.toLocaleString()}
        </span>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {scaleMax.toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-1">Current price</div>
          <div className="text-sm font-semibold text-white">{vault.currentPrice.toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-1">Lower bound</div>
          <div className="text-sm font-semibold text-white">{vault.lowerBound.toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-1">Upper bound</div>
          <div className="text-sm font-semibold text-white">{vault.upperBound.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        No historical pool price series is stored in this app yet, so the chart view stays disabled until a real history source is added.
      </div>
    </div>
  );
}
