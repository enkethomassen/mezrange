import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface StatCardProps {
  label: string;
  value: string;
  subvalue?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'orange' | 'green' | 'purple' | 'blue';
  delay?: number;
}

const colorMap = {
  orange: {
    icon: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    trend: 'text-orange-400',
  },
  green: {
    icon: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    trend: 'text-emerald-400',
  },
  purple: {
    icon: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    trend: 'text-purple-400',
  },
  blue: {
    icon: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    trend: 'text-cyan-400',
  },
};

export default function StatCard({ label, value, subvalue, icon: Icon, trend, trendValue, color = 'orange', delay = 0 }: StatCardProps) {
  const c = colorMap[color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="glass glass-hover rounded-2xl p-5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', c.bg, 'border', c.border)}>
          <Icon className={clsx('w-5 h-5', c.icon)} />
        </div>
        {trendValue && (
          <span className={clsx('text-xs font-medium', trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400')}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''} {trendValue}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
      {subvalue && <div className="text-xs text-slate-500 mt-0.5">{subvalue}</div>}
      <div className="text-xs text-slate-500 mt-2 font-medium uppercase tracking-wider">{label}</div>
    </motion.div>
  );
}
