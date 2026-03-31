
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
      label: 'TOTAL FACTURAS',
      value: total,
      icon: FileText,
      color: 'text-slate-600',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
    },
    {
      label: 'PROCESADAS',
      value: completed,
      subValue: `/ ${total}`,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
    },
    {
      label: 'EN CURSO / ERROR',
      value: processing,
      subValue: `| ${failed}`,
      icon: AlertCircle,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
    },
    {
      label: 'IMPORTE TOTAL',
      value: `${totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`,
      icon: Euro,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, idx) => (
        <div 
          key={idx} 
          className={`bg-white p-6 rounded-none border-2 ${stat.border} transition-all hover:scale-[1.02] group`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-14 h-14 ${stat.bg} ${stat.color} rounded-none flex items-center justify-center transition-transform group-hover:rotate-3 border border-white/10`}>
              <stat.icon size={28} strokeWidth={2.5} />
            </div>
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Estadísticas</span>
          </div>
          <div>
            <p className="text-sm font-black text-slate-500 uppercase tracking-[0.1em] mb-1">{stat.label}</p>
            <div className="flex items-baseline gap-2">
              <p className={`text-4xl font-black tracking-tight ${stat.color}`}>{stat.value}</p>
              {stat.subValue && <span className="text-lg font-black text-slate-300 tracking-tight">{stat.subValue}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
