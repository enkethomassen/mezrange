import { AlertTriangle } from 'lucide-react';
import type { Vault } from '../data/mockData';

interface ILTrackerProps {
  network: 'testnet' | 'mainnet';
  liveVaults: Vault[];
}

export default function ILTracker({ network, liveVaults }: ILTrackerProps) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-white">Impermanent Loss Tracking</span>
        </div>
        <div className="text-xs text-slate-500">Unavailable on {network}</div>
      </div>

      <div className="glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-slate-300">
        No live IL baseline is persisted yet. The current contracts and frontend do not store entry-price snapshots per user or per vault epoch, so showing IL figures here would be synthetic.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {liveVaults.map((vault) => (
          <div key={vault.id} className="glass rounded-xl p-4">
            <div className="text-sm font-medium text-white mb-1">{vault.name}</div>
            <div className="text-xs text-slate-500 mb-3">{vault.pair}</div>
            <div className="text-sm text-amber-400 font-semibold">No live IL data yet</div>
          </div>
        ))}
      </div>
    </div>
  );
}
