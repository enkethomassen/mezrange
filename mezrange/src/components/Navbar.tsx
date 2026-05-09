import { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, ChevronDown, Globe } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

interface NavbarProps {
  network: 'mainnet' | 'testnet';
  onNetworkChange: (n: 'mainnet' | 'testnet') => void;
}

export default function Navbar({ network, onNetworkChange }: NavbarProps) {
  const [netOpen, setNetOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 glass border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center">
            <Activity className="w-4 h-4 text-black" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-base tracking-tight">
            <span className="text-gradient">Mez</span>
            <span className="text-white">Range</span>
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Network selector */}
          <div className="relative">
            <button
              onClick={() => setNetOpen(!netOpen)}
              className="flex items-center gap-2 glass glass-hover rounded-lg px-3 py-1.5 text-sm"
            >
              <div className={`w-2 h-2 rounded-full ${network === 'testnet' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span className="capitalize text-slate-300">{network}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>
            {netOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute right-0 mt-2 w-40 glass rounded-xl border border-white/10 overflow-hidden z-50"
              >
                {(['mainnet', 'testnet'] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => { onNetworkChange(n); setNetOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors ${network === n ? 'text-orange-400' : 'text-slate-300'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${n === 'testnet' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    <span className="capitalize">{n}</span>
                    {n === 'mainnet' && <span className="ml-auto text-xs text-slate-500">Live</span>}
                    {n === 'testnet' && <span className="ml-auto text-xs text-slate-500">Test</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </div>

          {/* RainbowKit ConnectButton — real wallet connect:
              MetaMask, WalletConnect, Coinbase, and Bitcoin wallets via @mezo-org/passport */}
          <ConnectButton
            accountStatus="avatar"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </div>
    </nav>
  );
}
