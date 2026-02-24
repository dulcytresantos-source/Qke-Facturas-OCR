
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
      label: 'Total Facturas',
      value: total,
      icon: FileText,
      color: 'text-slate-600',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
    },
    {
      label: 'Procesadas',
      value: completed,
      subValue: `/ ${total}`,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-100',
    },
    {
      label: 'En curso / Error',
      value: processing,
      subValue: `| ${failed}`,
      icon: AlertCircle,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-amber-100',
    },
    {
      label: 'Importe Total',
      value: `${totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`,
      icon: Euro,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      border: 'border-indigo-100',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
      {stats.map((stat, idx) => (
        <div 
          key={idx} 
          className={`bg-white p-6 rounded-[32px] shadow-sm border ${stat.border} transition-all hover:shadow-md group`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110`}>
              <stat.icon size={24} strokeWidth={2.5} />
            </div>
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Live Stats</span>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
            <div className="flex items-baseline gap-2">
              <p className={`text-3xl font-black tracking-tight ${stat.color}`}>{stat.value}</p>
              {stat.subValue && <span className="text-sm font-bold text-slate-300">{stat.subValue}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
