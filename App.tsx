
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { InvoiceData, ProcessingStatus } from './types';
import { extractInvoiceData } from './services/geminiService';
import { fileToBase64, generateTSV, downloadFile, generateRenamedFileName, formatSpanishAmount, formatSpanishDate } from './utils/helpers';
import { StatsCards } from './components/StatsCards';

type SortKey = keyof InvoiceData;
interface SortConfig {
  key: SortKey | null;
  direction: 'asc' | 'desc';
}

const App: React.FC = () => {
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showTSVModal, setShowTSVModal] = useState(false);
  const [generatedTSV, setGeneratedTSV] = useState("");
  const [copyStatus, setCopyStatus] = useState("Copiar");
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
  const stopProcessingRef = useRef(false);
  
  // Estado para el Template de Numeración
  const [tempMonth, setTempMonth] = useState("");
  const [tempLastSeq, setTempLastSeq] = useState("");
  const seqInputRef = useRef<HTMLInputElement>(null);

  // Manejador ágil para el mes (auto-tab)
  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 2);
    setTempMonth(val);
    if (val.length === 2 && seqInputRef.current) {
      seqInputRef.current.focus();
    }
  };

  const handleSeqChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempLastSeq(e.target.value.replace(/\D/g, ''));
  };

  const lastSeqNum = parseInt(tempLastSeq, 10) || 0;

  // Recalcular nombres sugeridos cuando cambie el template
  useEffect(() => {
    setInvoices(prev => {
      let validCounter = 0;
      return prev.map(inv => {
        if (inv.status === ProcessingStatus.COMPLETED && !inv.isDuplicate) {
          const newName = generateRenamedFileName(inv, validCounter, inv.fileName, tempMonth, lastSeqNum);
          validCounter++;
          return { ...inv, renamedFileName: newName };
        }
        return inv;
      });
    });
  }, [tempMonth, lastSeqNum]);

  const addFilesToQueue = (files: FileList) => {
    const newInvoices: InvoiceData[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.includes('image/') && !file.type.includes('pdf')) continue;

      const alpha = Math.random().toString(36).substring(2, 6).toUpperCase();
      const internalId = `INV-${timestamp}-${alpha}`;
      
      const newInvoice: InvoiceData = {
        internalId,
        fileName: file.name,
        status: ProcessingStatus.PENDING,
        proveedor: '-',
        shortenedProveedor: '-',
        fechaFactura: '-',
        numeroFactura: '-',
        importe: 0,
      };

      (window as any)[`file_${internalId}`] = file;
      newInvoices.push(newInvoice);
    }

    if (newInvoices.length > 0) {
      setInvoices(prev => [...prev, ...newInvoices]);
    }
  };

  const processSingleInvoice = async (targetId: string) => {
    setInvoices(prev => prev.map(inv => 
      inv.internalId === targetId ? { ...inv, status: ProcessingStatus.PROCESSING, error: undefined } : inv
    ));

    try {
      const file = (window as any)[`file_${targetId}`] as File;
      if (!file) throw new Error("Archivo no encontrado");

      const { data, mimeType } = await fileToBase64(file);
      const result = await extractInvoiceData(data, mimeType);

      setInvoices(prev => {
        const original = prev.find(inv => 
          inv.status === ProcessingStatus.COMPLETED &&
          inv.internalId !== targetId &&
          inv.proveedor.trim().toLowerCase() === result.proveedor.trim().toLowerCase() &&
          inv.numeroFactura.trim() === result.numeroFactura.trim() &&
          inv.importe === result.importe
        );

        const currentBatch = prev.map(inv => {
          if (inv.internalId === targetId) {
            return { 
              ...inv, 
              ...result, 
              status: ProcessingStatus.COMPLETED,
              isDuplicate: !!original,
              duplicateOfName: original ? original.fileName : undefined
            };
          }
          return inv;
        });

        let validCounter = 0;
        return currentBatch.map(inv => {
          if (inv.status === ProcessingStatus.COMPLETED && !inv.isDuplicate) {
            const newName = generateRenamedFileName(inv, validCounter, inv.fileName, tempMonth, lastSeqNum);
            validCounter++;
            return { ...inv, renamedFileName: newName };
          }
          return inv;
        });
      });

    } catch (error) {
      console.error(`Error processing ${targetId}:`, error);
      setInvoices(prev => prev.map(inv => 
        inv.internalId === targetId ? { 
          ...inv, 
          status: ProcessingStatus.FAILED, 
          error: error instanceof Error ? error.message : "Error desconocido" 
        } : inv
      ));
    }
  };

  const processAllInvoices = async () => {
    const toProcess = invoices.filter(i => 
      i.status === ProcessingStatus.PENDING || i.status === ProcessingStatus.FAILED
    );
    
    if (toProcess.length === 0) return;
    
    setIsBatchProcessing(true);
    stopProcessingRef.current = false;
    
    // Procesamos en lotes de 2 para no saturar pero ir rápido
    const chunkSize = 2;
    for (let i = 0; i < toProcess.length; i += chunkSize) {
      if (stopProcessingRef.current) break;
      
      const chunk = toProcess.slice(i, i + chunkSize);
      // Ejecutamos el lote actual en paralelo
      await Promise.all(chunk.map(inv => processSingleInvoice(inv.internalId)));
    }
    
    setIsBatchProcessing(false);
    stopProcessingRef.current = false;
  };

  const handleStopProcessing = () => {
    stopProcessingRef.current = true;
  };

  const removeInvoice = (targetId: string) => {
    if ((window as any)[`file_${targetId}`]) {
      delete (window as any)[`file_${targetId}`];
    }
    setInvoices(prev => prev.filter(inv => inv.internalId !== targetId));
  };

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedInvoices = useMemo(() => {
    if (!sortConfig.key) return invoices;

    return [...invoices].sort((a, b) => {
      const aVal = a[sortConfig.key!] ?? '';
      const bVal = b[sortConfig.key!] ?? '';

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();

      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [invoices, sortConfig]);

  const handleCleanDuplicates = () => {
    setInvoices(prev => {
      const duplicates = prev.filter(inv => inv.isDuplicate);
      duplicates.forEach(d => delete (window as any)[`file_${d.internalId}`]);
      return prev.filter(inv => !inv.isDuplicate);
    });
  };

  const handleReset = () => {
    if (confirm("¿Estás seguro de que quieres borrar todas las facturas y empezar de cero?")) {
      invoices.forEach(inv => {
        if ((window as any)[`file_${inv.internalId}`]) {
          delete (window as any)[`file_${inv.internalId}`];
        }
      });
      setInvoices([]);
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  };

  const downloadOneRenamed = (inv: InvoiceData) => {
    const file = (window as any)[`file_${inv.internalId}`];
    if (file && inv.renamedFileName) {
      downloadFile(file, inv.renamedFileName, file.type);
    }
  };

  const downloadAllRenamed = () => {
    invoices.forEach((inv) => {
      if (inv.status === ProcessingStatus.COMPLETED && !inv.isDuplicate) {
        downloadOneRenamed(inv);
      }
    });
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortConfig.key !== column) return (
      <svg className="w-3 h-3 text-slate-300 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
      </svg>
    );
    return sortConfig.direction === 'asc' ? (
      <svg className="w-3 h-3 text-indigo-600 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"/>
      </svg>
    ) : (
      <svg className="w-3 h-3 text-indigo-600 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
      </svg>
    );
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-slate-50">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">
                InvoiceControl<span className="text-indigo-600">Pro</span>
              </h1>
            </div>
            <p className="text-slate-500 font-medium text-lg ml-1">
              Gestión inteligente de facturas con <span className="text-indigo-500 font-bold">IA</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] bg-slate-200 text-slate-600 px-3 py-1.5 rounded-full uppercase tracking-widest font-black border border-slate-300/50">
              v2.4 Stable
            </span>
            <span className="text-[10px] bg-indigo-600 text-white px-3 py-1.5 rounded-full uppercase tracking-widest font-black shadow-lg shadow-indigo-100">
              Manual OCR
            </span>
          </div>
        </header>

        {/* Control Center */}
        <div className="bg-white p-6 rounded-[40px] shadow-sm border border-slate-200 mb-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            
            {/* Template de Secuencia */}
            <div className="lg:col-span-3 space-y-3">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Template de Secuencia</label>
                <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-tight bg-indigo-50 px-2 py-0.5 rounded-md">
                  Siguiente: {(tempMonth || "MM")}-FC{String((lastSeqNum + 1)).padStart(2, '0')}
                </p>
              </div>
              <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-400 transition-all h-[56px]">
                <input 
                  type="text" 
                  placeholder="Mes"
                  value={tempMonth}
                  onChange={handleMonthChange}
                  className="w-full text-center bg-transparent text-sm font-black text-slate-700 outline-none placeholder:text-slate-300"
                />
                <div className="h-6 w-[1px] bg-slate-200 mx-2"></div>
                <span className="text-xs font-black text-slate-400 px-3 select-none">FC</span>
                <div className="h-6 w-[1px] bg-slate-200 mx-2"></div>
                <input 
                  ref={seqInputRef}
                  type="text" 
                  placeholder="Última"
                  value={tempLastSeq}
                  onChange={handleSeqChange}
                  className="w-full text-center bg-transparent text-sm font-black text-slate-700 outline-none placeholder:text-slate-300"
                />
              </div>
            </div>

            {/* Acciones Principales */}
            <div className="lg:col-span-6 flex flex-wrap sm:flex-nowrap gap-3">
              <button
                onClick={processAllInvoices}
                disabled={isBatchProcessing || !invoices.some(i => i.status === ProcessingStatus.PENDING || i.status === ProcessingStatus.FAILED)}
                className={`
                  flex-1 h-[56px] rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-3
                  ${isBatchProcessing 
                    ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 active:scale-95 disabled:opacity-50'}
                `}
              >
                {isBatchProcessing ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Procesando...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    Procesar Todas
                  </>
                )}
              </button>

              <button
                onClick={downloadAllRenamed}
                disabled={!invoices.some(i => i.status === ProcessingStatus.COMPLETED && !i.isDuplicate)}
                className="flex-1 h-[56px] rounded-2xl font-black text-xs uppercase tracking-widest transition-all bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Descargar Lote
              </button>
            </div>

            {/* Acciones Secundarias */}
            <div className="lg:col-span-3 flex gap-3">
              <button
                onClick={() => {
                  const tsv = generateTSV(invoices, tempMonth, lastSeqNum);
                  setGeneratedTSV(tsv);
                  setShowTSVModal(true);
                  setCopyStatus("Copiar");
                }}
                disabled={invoices.length === 0}
                className="flex-1 h-[56px] rounded-2xl font-black text-xs uppercase tracking-widest transition-all bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                Copiar TSV
              </button>

              <div className="flex flex-col gap-2">
                {isBatchProcessing && (
                  <button
                    onClick={handleStopProcessing}
                    className="w-[56px] h-[56px] rounded-2xl font-bold text-xs uppercase transition-all bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 active:scale-95 flex items-center justify-center shadow-sm animate-in zoom-in duration-200"
                    title="Detener proceso"
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={invoices.length === 0 || isBatchProcessing}
                  className="w-[56px] h-[56px] rounded-2xl font-bold text-xs uppercase transition-all bg-slate-50 text-slate-400 border border-slate-200 hover:text-rose-600 hover:border-rose-200 active:scale-95 disabled:opacity-30 flex items-center justify-center shadow-sm"
                  title="Reiniciar todo"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>

            {/* Botón Flotante de Duplicados (si existen) */}
            {invoices.some(i => i.isDuplicate) && (
              <div className="lg:col-span-12 flex justify-center -mt-2">
                <button
                  onClick={handleCleanDuplicates}
                  disabled={isBatchProcessing}
                  className="px-6 py-2 rounded-full font-black text-[10px] uppercase tracking-widest transition-all bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200 shadow-sm flex items-center gap-2 animate-in slide-in-from-top-2 duration-300"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  Limpiar {invoices.filter(i => i.isDuplicate).length} Duplicados Detectados
                </button>
              </div>
            )}
          </div>
        </div>

        <StatsCards invoices={invoices} />

        {/* Drop Zone */}
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFilesToQueue(e.dataTransfer.files); }}
          className={`
            relative mb-10 p-16 border-2 border-dashed rounded-[48px] flex flex-col items-center justify-center transition-all duration-500
            ${isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[0.99] shadow-inner' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50/50 shadow-sm'}
            cursor-pointer group
          `}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input id="file-upload" type="file" multiple className="hidden" onChange={(e) => e.target.files && addFilesToQueue(e.target.files)} accept="image/*,application/pdf" />
          <div className="w-24 h-24 bg-indigo-50 rounded-[32px] flex items-center justify-center mb-8 text-indigo-600 shadow-sm transition-transform group-hover:scale-110 group-hover:rotate-3">
             <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
          </div>
          <p className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Suelta tus facturas aquí</p>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-full">PDF</span>
            <span className="px-3 py-1 bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-full">JPG</span>
            <span className="px-3 py-1 bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-full">PNG</span>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-[40px] shadow-sm border border-slate-200 overflow-hidden mb-16">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-8 py-6">
                    <button onClick={() => handleSort('fileName')} className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">
                      Archivo Original <SortIcon column="fileName" />
                    </button>
                  </th>
                  <th className="px-8 py-6">
                    <button onClick={() => handleSort('proveedor')} className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">
                      Proveedor <SortIcon column="proveedor" />
                    </button>
                  </th>
                  <th className="px-8 py-6">
                    <button onClick={() => handleSort('fechaFactura')} className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">
                      Fecha <SortIcon column="fechaFactura" />
                    </button>
                  </th>
                  <th className="px-8 py-6">
                    <button onClick={() => handleSort('numeroFactura')} className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">
                      Nº Factura <SortIcon column="numeroFactura" />
                    </button>
                  </th>
                  <th className="px-8 py-6">
                    <button onClick={() => handleSort('importe')} className="flex items-center text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">
                      Importe <SortIcon column="importe" />
                    </button>
                  </th>
                  <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedInvoices.length === 0 ? (
                  <tr><td colSpan={6} className="px-8 py-24 text-center text-slate-300 italic font-medium">No hay facturas en la cola.</td></tr>
                ) : (
                  sortedInvoices.map((inv) => (
                    <tr key={inv.internalId} className={`hover:bg-slate-50/50 transition-colors group ${inv.isDuplicate ? 'bg-rose-50/30' : ''}`}>
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                           <span className={`text-sm font-bold truncate max-w-[200px] ${inv.isDuplicate ? 'text-rose-900 line-through opacity-40' : 'text-slate-900'}`} title={inv.fileName}>
                             {inv.fileName}
                           </span>
                           {inv.status === ProcessingStatus.COMPLETED && !inv.isDuplicate && (
                             <span className="text-xs text-indigo-600 font-black mt-2 bg-indigo-50 px-3 py-1.5 rounded-xl inline-block w-fit border border-indigo-100/50 uppercase tracking-tight shadow-sm">
                               → {inv.renamedFileName}
                             </span>
                           )}
                           <span className="text-[9px] font-black text-slate-300 uppercase mt-1 tracking-widest">ID: {inv.internalId.split('-').pop()}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-sm font-black text-slate-900">{inv.proveedor}</div>
                        {inv.shortenedProveedor !== '-' && <div className="text-[10px] text-indigo-500 font-black uppercase tracking-widest mt-1">{inv.shortenedProveedor}</div>}
                      </td>
                      <td className="px-8 py-6 text-sm text-slate-500 font-bold">{formatSpanishDate(inv.fechaFactura)}</td>
                      <td className="px-8 py-6 text-sm text-slate-500 font-bold">{inv.numeroFactura}</td>
                      <td className="px-8 py-6 text-sm font-black text-slate-900">
                        {inv.status === ProcessingStatus.COMPLETED ? (
                          <span className="bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200/50">
                            {formatSpanishAmount(inv.importe)}€
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 flex items-center gap-2">
                            {inv.status === ProcessingStatus.PENDING || inv.status === ProcessingStatus.FAILED ? (
                              <button
                                onClick={() => processSingleInvoice(inv.internalId)}
                                disabled={isBatchProcessing}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-2xl transition-all text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-100 disabled:opacity-30 active:scale-95"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                Escanear
                              </button>
                            ) : inv.status === ProcessingStatus.PROCESSING ? (
                               <span className="text-[9px] font-black text-amber-600 animate-pulse uppercase bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl tracking-widest">Procesando...</span>
                            ) : inv.isDuplicate ? (
                               <div className="flex flex-col gap-1.5 items-start">
                                 <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-xl shadow-lg shadow-rose-100">
                                    <span className="text-[9px] font-black tracking-widest uppercase">Duplicado</span>
                                 </div>
                                 <span className="text-[9px] text-rose-400 font-bold italic max-w-[140px] truncate" title={inv.duplicateOfName}>
                                   Original: {inv.duplicateOfName}
                                 </span>
                               </div>
                            ) : inv.status === ProcessingStatus.COMPLETED ? (
                               <div className="flex items-center gap-3">
                                 <span className="text-[9px] font-black text-emerald-600 uppercase bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl tracking-widest">Completado</span>
                                 <button 
                                   onClick={() => downloadOneRenamed(inv)}
                                   className="p-2.5 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-2xl transition-all border border-indigo-100 shadow-sm active:scale-90"
                                   title="Descargar archivo renombrado"
                                 >
                                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                 </button>
                               </div>
                            ) : null}
                          </div>
                          {/* Botón de Eliminar */}
                          <button
                            onClick={() => removeInvoice(inv.internalId)}
                            disabled={isBatchProcessing}
                            className="p-2.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all border border-transparent hover:border-rose-100 disabled:opacity-20 active:scale-90"
                            title="Eliminar registro"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TSV Modal */}
        {showTSVModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="px-10 py-8 border-b flex items-center justify-between bg-slate-50/30">
                <h3 className="font-black text-slate-800 tracking-tight uppercase text-sm flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 2v-6m10 10V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2z"/></svg>
                  </div>
                  Exportación Inteligente para Excel
                </h3>
                <button onClick={() => setShowTSVModal(false)} className="text-slate-400 hover:text-slate-600 transition-all p-3 bg-white rounded-full shadow-sm hover:rotate-90">✕</button>
              </div>
              <div className="p-10">
                <textarea
                  readOnly
                  value={generatedTSV}
                  className="w-full h-96 p-8 font-mono text-[11px] bg-slate-900 text-slate-300 rounded-[32px] border-none focus:ring-0 leading-relaxed overflow-x-auto shadow-2xl"
                  wrap="off"
                />
                <div className="mt-10 flex justify-between items-center">
                   <p className="text-xs text-slate-400 font-medium max-w-md">
                     Copia estos datos y pégalos directamente en Excel. Los duplicados se han mantenido como solicitaste.
                   </p>
                   <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(generatedTSV);
                      setCopyStatus("¡Copiado!");
                      setTimeout(() => setCopyStatus("Copiar"), 2000);
                    }}
                    className="bg-indigo-600 text-white px-12 py-5 rounded-[24px] font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-2xl shadow-indigo-100 flex items-center gap-3"
                  >
                    {copyStatus === "¡Copiado!" ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>}
                    {copyStatus}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
