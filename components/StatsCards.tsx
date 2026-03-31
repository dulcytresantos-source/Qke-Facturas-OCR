
import React from 'react';
import { InvoiceData, ProcessingStatus } from '../types';
import { FileText, CheckCircle2, AlertCircle, Euro } from 'lucide-react';

interface StatsCardsProps {
  invoices: InvoiceData[];
}

export const StatsCards: React.FC<StatsCardsProps> = ({ invoices }) => {
  const total = invoices.length;
  const completed = invoices.filter(i => i.status === ProcessingStatus.COMPLETED).length;
  const processing = invoices.filter(i => i.status === ProcessingStatus.PROCESSING).length;
  const failed = invoices.filter(i => i.status === ProcessingStatus.FAILED).length;
  const totalAmount = invoices
    .filter(i => i.status === ProcessingStatus.COMPLETED)
    .reduce((sum, i) => sum + i.importe, 0);

  const stats = [
    {
      label: 'TOTAL_FILES',
      value: total,
      icon: FileText,
      color: 'text-emerald-500',
      bg: 'bg-emerald-950/20',
      border: 'border-emerald-900/50',
    },
    {
      label: 'PROCESSED',
      value: completed,
      subValue: `/ ${total}`,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/30',
      border: 'border-emerald-500/30',
    },
    {
      label: 'ACTIVE / ERR',
      value: processing,
      subValue: `| ${failed}`,
      icon: AlertCircle,
      color: 'text-amber-500',
      bg: 'bg-amber-950/20',
      border: 'border-amber-500/30',
    },
    {
      label: 'TOTAL_VAL',
      value: `${totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`,
      icon: Euro,
      color: 'text-emerald-300',
      bg: 'bg-emerald-950/40',
      border: 'border-emerald-500/50',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
      {stats.map((stat, idx) => (
        <div 
          key={idx} 
          className={`bg-black p-3 rounded border ${stat.border} transition-all hover:border-emerald-500 group shadow-lg`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className={`w-8 h-8 ${stat.bg} ${stat.color} rounded flex items-center justify-center transition-transform group-hover:scale-110 border border-emerald-500/20`}>
              <stat.icon size={16} strokeWidth={2.5} />
            </div>
            <span className="text-[7px] font-black text-emerald-900 uppercase tracking-widest">DATA_NODE_{idx}</span>
          </div>
          <div>
            <p className="text-[8px] font-bold text-emerald-700 uppercase tracking-wider mb-0.5">{stat.label}</p>
            <div className="flex items-baseline gap-1.5">
              <p className={`text-lg font-black tracking-tighter ${stat.color}`}>{stat.value}</p>
              {stat.subValue && <span className="text-[10px] font-bold text-emerald-900">{stat.subValue}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
