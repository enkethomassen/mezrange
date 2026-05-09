import { motion } from 'framer-motion';
import { Wallet, Coins, ExternalLink, Layers3 } from 'lucide-react';
import type { Vault } from '../data/mockData';
import { formatCurrency } from '../data/mockData';
import { explorerLink } from '../data/deployedContracts';

interface PortfolioBarProps {
  liveVaults: Vault[];
  walletAddress?: string;
  isConnected: boolean;
}

export default function PortfolioBar({ liveVaults, walletAddress, isConnected }: PortfolioBarProps) {
  const totalVaultValue = liveVaults.reduce((sum, vault) => sum + vault.myDeposit, 0);
  const totalShares = liveVaults.reduce((sum, vault) => sum + vault.myShares, 0);
  const activeVaults = liveVaults.filter((vault) => vault.myShares > 0).length;

  if (!isConnected && totalVaultValue === 0 && totalShares === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass border-b border-white/5"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-6 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-2 text-xs shrink-0">
          <Wallet className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-slate-500">My Vault Position</span>
          {walletAddress && (
            <a
              href={explorerLink(walletAddress, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-orange-400 transition-colors flex items-center gap-0.5"
            >
              <span className="font-mono">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>

        {(totalVaultValue > 0 || totalShares > 0) ? (
          <div className="flex items-center gap-6">
            <div className="text-xs shrink-0">
              <span className="text-slate-500">Current vault value </span>
              <span className="text-white font-semibold">{formatCurrency(totalVaultValue)}</span>
            </div>
            <div className="text-xs shrink-0 flex items-center gap-1">
              <Coins className="w-3 h-3 text-amber-400" />
              <span className="text-slate-500">Vault shares </span>
              <span className="text-amber-400 font-semibold">{totalShares.toFixed(4)}</span>
            </div>
            <div className="text-xs shrink-0 flex items-center gap-1">
              <Layers3 className="w-3 h-3 text-cyan-400" />
              <span className="text-slate-500">Active vaults </span>
              <span className="text-white font-semibold">{activeVaults}</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic">
            Connect a wallet and deposit to see live vault balances. PnL is not shown because cost-basis tracking is not stored yet.
          </div>
        )}
      </div>
    </motion.div>
  );
}
