import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DollarSign, RefreshCw, TrendingUp, Zap, ChevronRight, Shield, FileCode, AlertTriangle, GitFork, Activity } from 'lucide-react';
import { useAccount } from 'wagmi';

import Navbar from './components/Navbar';
import StatCard from './components/StatCard';
import VaultCard from './components/VaultCard';
import VaultModal from './components/VaultModal';
import RebalanceTimeline from './components/RebalanceTimeline';
import ILTracker from './components/ILTracker';
import APYChart from './components/APYChart';
import PortfolioBar from './components/PortfolioBar';
import { VAULTS, formatCurrency } from './data/mockData';
import type { Vault } from './data/mockData';
import { buildLiveVault } from './data/liveData';
import { DEPLOYED_CONTRACTS, isDeployed, explorerLink } from './data/deployedContracts';
import { useProtocolStats } from './hooks/useProtocolStats';
import { usePrices } from './hooks/usePrices';
import './index.css';

type Tab = 'vaults' | 'analytics' | 'contracts';

export default function App() {
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('testnet');
  const [selectedVault, setSelectedVault] = useState<Vault | null>(null);
  const [tab, setTab] = useState<Tab>('vaults');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Real wallet state from wagmi
  const { address: walletAddress, isConnected } = useAccount();

  // Live on-chain protocol stats
  const onChainStats = useProtocolStats(network === 'mainnet' ? 'mainnet' : 'testnet');
  // Real market prices
  const prices = usePrices();

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Build live vault display objects by merging on-chain data + real prices
  const LIVE_VAULTS: Vault[] = useMemo(() => VAULTS.map(v => {
    const onChain = onChainStats.vaults[v.id];
    if (!onChain) return v;
    return buildLiveVault(v.id, onChain, prices, v);
  }).filter((v): v is Vault => v !== null), [onChainStats, prices]);

  const totalTVL = LIVE_VAULTS.reduce((s, v) => s + v.tvl, 0);
  const totalRebalances = onChainStats.hasLiveData
    ? onChainStats.totalRebalances
    : LIVE_VAULTS.reduce((s, v) => s + v.rebalanceCount, 0);
  const totalFees = onChainStats.hasLiveData ? onChainStats.totalFeesEarned : LIVE_VAULTS.reduce((s, v) => s + v.feesEarned, 0);
  const vaultsWithApy = LIVE_VAULTS.filter((v) => v.apy > 0);
  const avgAPY = vaultsWithApy.length > 0
    ? vaultsWithApy.reduce((s, v) => s + v.apy, 0) / vaultsWithApy.length
    : 0;

  // Contracts for the contracts tab — built from deployedContracts.ts
  const contractsNet = network === 'testnet' ? DEPLOYED_CONTRACTS.testnet : DEPLOYED_CONTRACTS.mainnet;
  const vaultEntries = [
    { name: 'MezRangeVault (BTC/mUSD)',  addr: contractsNet.vaults.btcMusd.vault,    strat: contractsNet.vaults.btcMusd.strategy },
    { name: 'MezRangeVault (MEZO/mUSD)', addr: contractsNet.vaults.mezoMusd.vault,   strat: contractsNet.vaults.mezoMusd.strategy },
    { name: 'MezRangeVault (BTC/mUSD 10 bps)',  addr: contractsNet.vaults.btcMezo.vault,    strat: contractsNet.vaults.btcMezo.strategy },
    { name: 'NonfungiblePositionManager', addr: contractsNet.positionManager,         strat: '' },
    { name: 'SwapRouter',                addr: contractsNet.swapRouter,              strat: '' },
    { name: 'Keeper Bot Wallet',         addr: contractsNet.keeperBot,               strat: '' },
  ];

  return (
    <div className="min-h-screen bg-[#070b14]">
      {/* Background gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-cyan-500/4 rounded-full blur-3xl" />
      </div>

      <Navbar network={network} onNetworkChange={setNetwork} />

      <PortfolioBar liveVaults={LIVE_VAULTS} walletAddress={walletAddress} isConnected={isConnected} />

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">MezRange</h1>
              <p className="text-slate-400 text-base max-w-xl">
                Automated concentrated liquidity vaults for Mezo's DEX.
                Earn maximum fees 24/7 without manual rebalancing.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {onChainStats.hasLiveData ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>On-chain · {currentTime.toLocaleTimeString()}</span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                  <span>Connecting · {currentTime.toLocaleTimeString()}</span>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Protocol stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Value Locked" value={totalTVL > 0 ? formatCurrency(totalTVL) : 'No liquidity deposited yet'} subvalue={`${LIVE_VAULTS.length} configured vaults`} icon={DollarSign} color="orange" trend={onChainStats.hasLiveData ? 'up' : undefined} trendValue={onChainStats.hasLiveData ? 'Live' : undefined} delay={0} />
          <StatCard label="Avg APY" value={avgAPY > 0 ? `${avgAPY.toFixed(1)}%` : 'No live APY data yet'} subvalue="Derived from live fees only" icon={TrendingUp} color="green" delay={0.05} />
          <StatCard label="Total Rebalances" value={totalRebalances.toString()} subvalue="On-chain events only" icon={RefreshCw} color="purple" delay={0.1} />
          <StatCard label="Fees Earned" value={totalFees > 0 ? formatCurrency(totalFees) : '$0.00'} subvalue="Collected on-chain" icon={Zap} color="blue" delay={0.15} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 glass rounded-2xl p-1.5 w-fit">
          {(['vaults', 'analytics', 'contracts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-xl text-sm font-medium capitalize transition-all ${
                tab === t ? 'bg-orange-500 text-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'vaults' && (
            <motion.div key="vaults" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mb-8">
                {LIVE_VAULTS.map((v, i) => (
                  <VaultCard key={v.id} vault={v} onClick={() => setSelectedVault(v)} delay={i * 0.06} />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <RebalanceTimeline network={network} liveVaults={LIVE_VAULTS} />
                <ILTracker network={network} liveVaults={LIVE_VAULTS} />
              </div>
            </motion.div>
          )}

          {tab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <APYChart liveVaults={LIVE_VAULTS} />
                <div className="glass rounded-2xl p-5">
                  <div className="font-semibold text-white mb-4">Strategy Comparison</div>
                  <div className="space-y-3">
                    {[
                      { name: 'Tight ±3%', apy: LIVE_VAULTS.find(v => v.strategy === 'tight')?.apy ?? 0, rebalances: LIVE_VAULTS.find(v => v.strategy === 'tight')?.rebalanceCount ?? 0, bar: 'from-red-500 to-orange-500' },
                      { name: 'Medium ±10%', apy: LIVE_VAULTS.find(v => v.strategy === 'medium')?.apy ?? 0, rebalances: LIVE_VAULTS.find(v => v.strategy === 'medium')?.rebalanceCount ?? 0, bar: 'from-amber-500 to-yellow-500' },
                      { name: 'Wide ±30%', apy: LIVE_VAULTS.find(v => v.strategy === 'wide')?.apy ?? 0, rebalances: LIVE_VAULTS.find(v => v.strategy === 'wide')?.rebalanceCount ?? 0, bar: 'from-green-500 to-emerald-500' },
                    ].map(s => (
                      <div key={s.name} className="glass rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-white font-medium">{s.name}</span>
                          <span className="text-sm font-bold text-emerald-400">{s.apy > 0 ? `${s.apy.toFixed(1)}% APY` : 'No live APY data yet'}</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${s.bar}`}
                            style={{ width: `${Math.min(100, Math.max(0, (s.apy / 65) * 100))}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500">{s.rebalances} on-chain rebalances</div>
                      </div>
                    ))}
                  </div>
                </div>
                <RebalanceTimeline network={network} liveVaults={LIVE_VAULTS} />
                <ILTracker network={network} liveVaults={LIVE_VAULTS} />
              </div>
            </motion.div>
          )}

          {tab === 'contracts' && (
            <motion.div key="contracts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Contract addresses */}
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <FileCode className="w-4 h-4 text-orange-400" />
                    <span className="font-semibold text-white">Deployed Contracts</span>
                    <span className="ml-auto text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5 capitalize">{network}</span>
                  </div>
                  <div className="space-y-3">
                    {vaultEntries.map(c => {
                      const deployed = isDeployed(c.addr);
                      return (
                        <div key={c.name} className="flex items-center justify-between glass rounded-xl px-4 py-3">
                          <div>
                            <div className="text-sm text-white font-medium">{c.name}</div>
                            {deployed ? (
                              <a
                                href={explorerLink(c.addr, 'address', network)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-orange-400 mt-0.5 hover:text-orange-300 transition-colors"
                              >
                                {c.addr.slice(0, 10)}...{c.addr.slice(-8)}
                              </a>
                            ) : (
                              <div className="flex items-center gap-1 mt-0.5">
                                <AlertTriangle className="w-3 h-3 text-amber-400" />
                                <span className="text-xs text-amber-400">Not yet deployed</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {deployed ? (
                              <span className="text-xs text-emerald-400 flex items-center gap-1">
                                <Shield className="w-3 h-3" />Live
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">Pending</span>
                            )}
                            {deployed && <ChevronRight className="w-4 h-4 text-slate-500" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-xs text-slate-500 leading-relaxed">
                    Mainnet is not configured in this repository yet. Testnet addresses are hard-coded in{' '}
                    <code className="text-orange-400 bg-orange-500/10 px-1 rounded">deployedContracts.ts</code>.
                  </p>
                </div>

                {/* Architecture */}
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <Activity className="w-4 h-4 text-orange-400" />
                    <span className="font-semibold text-white">System Architecture</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    {[
                      {
                        layer: '1. Vault Layer (ERC-4626)',
                        desc: 'Users deposit tokens, receive share tokens. Handles fee accounting, share math, performance/management fees.',
                        color: 'border-orange-500/30 bg-orange-500/5',
                      },
                      {
                        layer: '2. Strategy Layer',
                        desc: 'Integrates Uniswap V3 NonfungiblePositionManager. addLiquidity, removeLiquidity, collectFees, rebalance().',
                        color: 'border-purple-500/30 bg-purple-500/5',
                      },
                      {
                        layer: '3. Keeper Bot (Node.js)',
                        desc: 'Monitors pool ticks every block. Calls rebalance() when price exits range. TWAP-based MEV protection.',
                        color: 'border-cyan-500/30 bg-cyan-500/5',
                      },
                      {
                        layer: '4. Frontend (React + Vite)',
                        desc: 'Live dashboard: range viz, rebalance history, IL tracking, wallet integration via RainbowKit.',
                        color: 'border-emerald-500/30 bg-emerald-500/5',
                      },
                    ].map(item => (
                      <div key={item.layer} className={`rounded-xl border p-3 ${item.color}`}>
                        <div className="text-white font-medium text-xs mb-1">{item.layer}</div>
                        <div className="text-slate-400 text-xs leading-relaxed">{item.desc}</div>
                      </div>
                    ))}
                  </div>
                  <a
                    href="https://github.com/enkethomassen/mezrange"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex items-center gap-2 text-xs text-slate-500 cursor-pointer hover:text-orange-400 transition-colors"
                  >
                    <GitFork className="w-4 h-4" />
                    View full source on GitHub
                    <ChevronRight className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Security */}
                <div className="glass rounded-2xl p-5 lg:col-span-2">
                  <div className="flex items-center gap-2 mb-5">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-white">Security Features</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { name: 'ReentrancyGuard', desc: 'Prevents re-entrant calls on all state-changing functions' },
                      { name: 'Pausable', desc: 'Emergency pause by admin in case of exploit' },
                      { name: 'AccessControl', desc: 'Role-based permissions for keeper/admin/vault' },
                      { name: 'Slippage Checks', desc: 'Configurable minAmounts on all liquidity ops and swaps' },
                      { name: 'TWAP Oracle', desc: '5-min TWAP for MEV-resistant range calculation' },
                      { name: 'Oracle Fallback', desc: 'Falls back to spot tick if TWAP unavailable' },
                      { name: 'Token Rescue', desc: 'Admin can rescue stuck tokens when paused' },
                      { name: 'Fee Caps', desc: 'Max 20% perf fee & 2% mgmt fee on-chain enforced' },
                    ].map(item => (
                      <div key={item.name} className="glass rounded-xl p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span className="text-xs font-semibold text-white">{item.name}</span>
                        </div>
                        <div className="text-xs text-slate-500 leading-relaxed">{item.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-16 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-slate-600">
          <span>MezRange — Automated LP Vaults for Mezo DeFi</span>
          <span>Built for Mezo DEX · Uniswap V3 Compatible</span>
        </div>
      </footer>

      <VaultModal
        vault={selectedVault ? (LIVE_VAULTS.find(v => v.id === selectedVault.id) ?? selectedVault) : null}
        onClose={() => setSelectedVault(null)}
        walletAddress={walletAddress}
        isConnected={isConnected}
        network={network}
      />
    </div>
  );
}
