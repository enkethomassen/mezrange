import { motion } from 'framer-motion';
import { RefreshCw, ExternalLink, Loader2, Radio } from 'lucide-react';
import type { Vault } from '../data/mockData';
import { timeAgo } from '../data/mockData';
import { useRebalanceEvents, txExplorerLink } from '../hooks/useRebalanceEvents';

interface RebalanceTimelineProps {
  network: 'testnet' | 'mainnet';
  liveVaults: Vault[];
}

export default function RebalanceTimeline({ network, liveVaults }: RebalanceTimelineProps) {
  const { events: liveEvents, isLoading, isLive } = useRebalanceEvents(network);

  const sorted = [...liveEvents].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-orange-400" />
          <span className="font-semibold text-white">Rebalance History</span>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Radio className="w-3 h-3" />Live
            </span>
          )}
          <span className="text-xs text-slate-500">{sorted.length} events</span>
        </div>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-orange-500/30 via-white/5 to-transparent" />

        <div className="space-y-4 pl-10">
          {sorted.map((ev, i) => {
            const vault = liveVaults.find(v => v.id === ev.vaultId);
            const txLink = isLive ? txExplorerLink(ev.txHash, network) : undefined;
            return (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative"
              >
                {/* Dot */}
                <div className="absolute -left-6 top-3 w-2 h-2 rounded-full bg-orange-400 border-2 border-slate-900" />

                <div className="glass rounded-xl p-3.5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-white">{vault?.pair ?? ev.vaultId}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-slate-500">{timeAgo(ev.timestamp)}</span>
                        <span className="text-slate-700">·</span>
                        {txLink ? (
                          <a
                            href={txLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-0.5"
                          >
                            {ev.txHash.slice(0, 10)}…
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 font-mono">{ev.txHash}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500 block">Old range</span>
                      <span className="text-white">{ev.oldLower.toLocaleString()}–{ev.oldUpper.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Fees collected</span>
                      <span className="text-orange-400">${ev.feesCollected.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">New range</span>
                      <span className="text-slate-300 truncate block">
                        {ev.newLower.toLocaleString()}–{ev.newUpper.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {sorted.length === 0 && !isLoading && (
            <div className="text-center text-slate-500 py-6 text-sm">No rebalances executed yet</div>
          )}
          {isLoading && (
            <div className="text-center text-slate-500 py-6 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Fetching on-chain events…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
