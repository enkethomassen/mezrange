import type { Vault } from '../data/mockData';

interface APYChartProps {
  liveVaults: Vault[];
}

export default function APYChart({ liveVaults }: APYChartProps) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="font-semibold text-white">APY Snapshot</div>
          <div className="text-xs text-slate-500">Only live on-chain fee-derived APY is shown</div>
        </div>
      </div>

      <div className="space-y-3">
        {liveVaults.map((vault) => (
          <div key={vault.id} className="glass rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">{vault.name}</div>
              <div className="text-xs text-slate-500">{vault.pair}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-emerald-400">
                {vault.apy > 0 ? `${vault.apy.toFixed(1)}%` : 'No live APY data yet'}
              </div>
              <div className="text-xs text-slate-500">
                {vault.apy > 0 ? 'Annualised from live fees' : 'Historical APY series unavailable'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
