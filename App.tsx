
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
  
  const hasApiKey = Boolean(process.env.API_KEY) && process.env.API_KEY !== "undefined" && process.env.API_KEY !== "";

  // Estado para el Template de Numeración
  const [tempMonth, setTempMonth] = useState("");
  const [tempLastSeq, setTempLastSeq] = useState("");
  const seqInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Prevenir el icono de "prohibido" en toda la página y manejar drops accidentales
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      // Solo prevenir si estamos arrastrando archivos
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = (e: DragEvent) => {
      // Prevenir que el navegador abra el archivo si se suelta fuera del dropzone
      e.preventDefault();
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

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
      <svg className="w-3 h-3 text-emerald-900 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
      </svg>
    );
    return sortConfig.direction === 'asc' ? (
      <svg className="w-3 h-3 text-emerald-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"/>
      </svg>
    ) : (
      <svg className="w-3 h-3 text-emerald-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
      </svg>
    );
  };

  return (
    <div className="min-h-screen p-2 md:p-4 bg-slate-950 text-emerald-500 font-mono">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-emerald-900/30 pb-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-8 h-8 bg-emerald-600 rounded flex items-center justify-center shadow-lg shadow-emerald-900/20">
                <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h1 className="text-xl font-black tracking-tighter uppercase">
                Invoice<span className="text-white">Matrix</span>_v2.4
              </h1>
            </div>
            <p className="text-emerald-700 font-bold text-[10px] ml-1 uppercase tracking-[0.2em]">
              System.Status: <span className="text-emerald-400 animate-pulse">Online</span> // Neural_OCR_Active
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!hasApiKey && (
              <div className="bg-rose-950/50 border border-rose-500/50 px-3 py-1 rounded flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"></div>
                <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">
                  CRITICAL: Missing_API_Key
                </p>
              </div>
            )}
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-emerald-800 uppercase tracking-widest font-black">
                Terminal_ID: {Math.random().toString(36).substring(7).toUpperCase()}
              </span>
              <span className="text-[9px] text-emerald-600 uppercase tracking-widest font-black">
                Kernel_Ready
              </span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Dropzone & Table */}
          <div className="lg:col-span-9 space-y-4">
            {/* Drop Zone (Matrix Style) */}
            <div 
              onDragOver={(e) => { 
                e.preventDefault(); 
                e.stopPropagation();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'copy';
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter.current++;
                if (e.dataTransfer?.types.includes('Files')) {
                  setIsDragging(true);
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter.current--;
                if (dragCounter.current === 0) {
                  setIsDragging(false);
                }
              }}
              onDrop={(e) => { 
                e.preventDefault(); 
                e.stopPropagation();
                dragCounter.current = 0;
                setIsDragging(false); 
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  addFilesToQueue(e.dataTransfer.files); 
                }
              }}
              className={`
                relative p-6 border border-emerald-500/30 rounded flex flex-col items-center justify-center transition-all duration-300 overflow-hidden
                ${isDragging ? 'bg-emerald-500/10 border-emerald-400 scale-[0.99] shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-black hover:border-emerald-500/50 shadow-inner'}
                cursor-pointer group min-h-[160px]
              `}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              {/* Matrix Rain Effect Background (CSS only) */}
              <div className="absolute inset-0 opacity-5 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full flex justify-around text-[8px] leading-none">
                  {[...Array(20)].map((_, i) => (
                    <div key={i} className="animate-matrix-rain" style={{ animationDelay: `${Math.random() * 5}s` }}>
                      {Math.random().toString(36).substring(2, 15).repeat(10)}
                    </div>
                  ))}
                </div>
              </div>

              <input id="file-upload" type="file" multiple className="hidden" onChange={(e) => e.target.files && addFilesToQueue(e.target.files)} accept="image/*,application/pdf" />
              
              <div className={`w-12 h-12 rounded border border-emerald-500/50 flex items-center justify-center mb-3 text-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all group-hover:scale-110 ${isBatchProcessing ? 'animate-pulse bg-emerald-500/20' : ''}`}>
                 {isBatchProcessing ? (
                   <svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                 ) : (
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                 )}
              </div>
              
              <p className="text-sm font-black text-emerald-400 mb-1 tracking-[0.3em] uppercase">
                {isBatchProcessing ? ">> PROCESANDO_DATOS_NEURALES <<" : ">> ARRASTRAR_FACTURAS_AQUÍ <<"}
              </p>
              <div className="flex items-center gap-2 opacity-50">
                <span className="text-[8px] font-black uppercase tracking-widest">Formatos: PDF | JPG | PNG</span>
              </div>

              {/* Scan Line Effect */}
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/20 animate-scan-line pointer-events-none"></div>
            </div>

            {/* Table (Matrix Style) */}
            <div className="bg-black rounded border border-emerald-900/50 overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-emerald-950/30 border-b border-emerald-900/50">
                      <th className="px-3 py-2">
                        <button onClick={() => handleSort('fileName')} className="flex items-center text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-400 transition-colors">
                          ORIGIN_FILE <SortIcon column="fileName" />
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button onClick={() => handleSort('proveedor')} className="flex items-center text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-400 transition-colors">
                          VENDOR <SortIcon column="proveedor" />
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button onClick={() => handleSort('fechaFactura')} className="flex items-center text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-400 transition-colors">
                          DATE <SortIcon column="fechaFactura" />
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button onClick={() => handleSort('numeroFactura')} className="flex items-center text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-400 transition-colors">
                          INV_NUM <SortIcon column="numeroFactura" />
                        </button>
                      </th>
                      <th className="px-3 py-2">
                        <button onClick={() => handleSort('importe')} className="flex items-center text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-400 transition-colors">
                          AMOUNT <SortIcon column="importe" />
                        </button>
                      </th>
                      <th className="px-3 py-2 text-[8px] font-black text-emerald-600 uppercase tracking-widest">CMD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-900/20">
                    {sortedInvoices.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-emerald-900 italic text-[10px] uppercase tracking-widest">No_Data_In_Queue</td></tr>
                    ) : (
                      sortedInvoices.map((inv) => (
                        <tr key={inv.internalId} className={`hover:bg-emerald-500/5 transition-colors group ${inv.isDuplicate ? 'bg-rose-950/20' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="flex flex-col">
                               <div className="flex items-center gap-2">
                                 <span className={`text-[10px] font-bold truncate max-w-[120px] ${inv.isDuplicate ? 'text-rose-500 line-through opacity-50' : 'text-emerald-400'}`} title={inv.fileName}>
                                   {inv.fileName}
                                 </span>
                                 {inv.status === ProcessingStatus.COMPLETED && !inv.isDuplicate && (
                                   <span className="text-[7px] text-emerald-300 font-black bg-emerald-900/50 px-1 py-0.5 rounded border border-emerald-500/30 uppercase tracking-tighter">
                                     {" > "} {inv.renamedFileName}
                                   </span>
                                 )}
                               </div>
                               <span className="text-[6px] font-black text-emerald-900 uppercase mt-0.5 tracking-widest">HASH: {inv.internalId.split('-').pop()}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[10px] font-black text-emerald-200">{inv.proveedor}</div>
                            {inv.shortenedProveedor !== '-' && <div className="text-[7px] text-emerald-500 font-black uppercase tracking-widest mt-0.5">{inv.shortenedProveedor}</div>}
                          </td>
                          <td className="px-3 py-2 text-[10px] text-emerald-600 font-bold">{formatSpanishDate(inv.fechaFactura)}</td>
                          <td className="px-3 py-2 text-[10px] text-emerald-600 font-bold">{inv.numeroFactura}</td>
                          <td className="px-3 py-2 text-[10px] font-black text-emerald-400">
                            {inv.status === ProcessingStatus.COMPLETED ? (
                              <span className="bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                {formatSpanishAmount(inv.importe)}€
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {inv.status === ProcessingStatus.PENDING || inv.status === ProcessingStatus.FAILED ? (
                                <button
                                  onClick={() => processSingleInvoice(inv.internalId)}
                                  disabled={isBatchProcessing}
                                  className="p-1 bg-emerald-600 text-black hover:bg-emerald-400 rounded transition-all disabled:opacity-30 active:scale-95"
                                  title="Escanear"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                </button>
                              ) : inv.status === ProcessingStatus.PROCESSING ? (
                                 <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                              ) : inv.isDuplicate ? (
                                 <span className="text-[6px] font-black text-rose-500 uppercase border border-rose-500/30 px-1 py-0.5 rounded">DUP</span>
                              ) : inv.status === ProcessingStatus.COMPLETED ? (
                                 <div className="flex items-center gap-1">
                                   <button 
                                     onClick={() => downloadOneRenamed(inv)}
                                     className="p-1 text-emerald-500 hover:bg-emerald-500 hover:text-black rounded transition-all border border-emerald-500/30 active:scale-90"
                                     title="Descargar"
                                   >
                                     <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                   </button>
                                 </div>
                              ) : null}
                              <button
                                onClick={() => removeInvoice(inv.internalId)}
                                disabled={isBatchProcessing}
                                className="p-1 text-emerald-900 hover:text-rose-500 transition-all disabled:opacity-20 active:scale-90"
                                title="Eliminar"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
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
          </div>

          {/* Right Column: Controls & Stats */}
          <div className="lg:col-span-3 space-y-4">
            {/* Control Center (Vertical) */}
            <div className="bg-black p-4 rounded border border-emerald-900/50 shadow-2xl space-y-4">
              <h2 className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em] border-b border-emerald-900/30 pb-2">Control_Panel</h2>
              
              {/* Template de Secuencia */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[8px] font-black text-emerald-700 uppercase tracking-widest">Sequence_Template</label>
                </div>
                <div className="flex items-center bg-emerald-950/20 border border-emerald-900/50 rounded p-1 focus-within:border-emerald-500 transition-all h-[36px]">
                  <input 
                    type="text" 
                    placeholder="MM"
                    value={tempMonth}
                    onChange={handleMonthChange}
                    className="w-12 text-center bg-transparent text-[10px] font-black text-emerald-400 outline-none placeholder:text-emerald-900"
                  />
                  <div className="h-3 w-[1px] bg-emerald-900 mx-1"></div>
                  <span className="text-[8px] font-black text-emerald-700 px-1 select-none">FC</span>
                  <div className="h-3 w-[1px] bg-emerald-900 mx-1"></div>
                  <input 
                    ref={seqInputRef}
                    type="text" 
                    placeholder="SEQ"
                    value={tempLastSeq}
                    onChange={handleSeqChange}
                    className="w-full text-center bg-transparent text-[10px] font-black text-emerald-400 outline-none placeholder:text-emerald-900"
                  />
                </div>
                <p className="text-[7px] text-emerald-600 font-bold uppercase tracking-tight text-center">
                  Next: {(tempMonth || "MM")}-FC{String((lastSeqNum + 1)).padStart(2, '0')}
                </p>
              </div>

              {/* Acciones Principales (Vertical Stack) */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={processAllInvoices}
                  disabled={isBatchProcessing || !invoices.some(i => i.status === ProcessingStatus.PENDING || i.status === ProcessingStatus.FAILED)}
                  className={`
                    w-full h-[36px] rounded font-black text-[9px] uppercase tracking-widest transition-all flex items-center justify-center gap-2
                    ${isBatchProcessing 
                      ? 'bg-amber-900/20 text-amber-500 border border-amber-500/30' 
                      : 'bg-emerald-600 text-black hover:bg-emerald-400 active:scale-95 disabled:opacity-30'}
                  `}
                >
                  {isBatchProcessing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                      Run_All
                    </>
                  )}
                </button>

                <button
                  onClick={downloadAllRenamed}
                  disabled={!invoices.some(i => i.status === ProcessingStatus.COMPLETED && !i.isDuplicate)}
                  className="w-full h-[36px] rounded font-black text-[9px] uppercase tracking-widest transition-all bg-emerald-900/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-900/40 active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Batch_Export
                </button>

                <button
                  onClick={() => {
                    const tsv = generateTSV(invoices, tempMonth, lastSeqNum);
                    setGeneratedTSV(tsv);
                    setShowTSVModal(true);
                    setCopyStatus("Copiar");
                  }}
                  disabled={invoices.length === 0}
                  className="w-full h-[36px] rounded font-black text-[9px] uppercase tracking-widest transition-all bg-emerald-900/20 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-900/40 active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                  Copy_TSV
                </button>
              </div>

              {/* Secondary Actions */}
              <div className="flex gap-2 pt-2 border-t border-emerald-900/30">
                {isBatchProcessing && (
                  <button
                    onClick={handleStopProcessing}
                    className="flex-1 h-[32px] rounded font-bold text-[8px] uppercase transition-all bg-rose-950/50 text-rose-500 border border-rose-500/30 hover:bg-rose-900/50 active:scale-95 flex items-center justify-center"
                  >
                    Abort
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={invoices.length === 0 || isBatchProcessing}
                  className="flex-1 h-[32px] rounded font-bold text-[8px] uppercase transition-all bg-emerald-950/10 text-emerald-900 border border-emerald-900/30 hover:text-rose-500 hover:border-rose-500/30 active:scale-95 disabled:opacity-10 flex items-center justify-center"
                >
                  Reset_System
                </button>
              </div>
            </div>

            <StatsCards invoices={invoices} />

            {/* Duplicates Alert */}
            {invoices.some(i => i.isDuplicate) && (
              <button
                onClick={handleCleanDuplicates}
                disabled={isBatchProcessing}
                className="w-full py-2 rounded font-black text-[8px] uppercase tracking-widest transition-all bg-rose-950/50 text-rose-500 border border-rose-500/30 hover:bg-rose-900/50 flex items-center justify-center gap-2 animate-pulse"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                Purge_{invoices.filter(i => i.isDuplicate).length}_Duplicates
              </button>
            )}
          </div>
        </div>

        {/* TSV Modal (Matrix Style) */}
        {showTSVModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-black rounded border border-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.2)] w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="px-6 py-3 border-b border-emerald-900/50 flex items-center justify-between bg-emerald-950/20">
                <h3 className="font-black text-emerald-400 tracking-[0.2em] uppercase text-[10px] flex items-center gap-2.5">
                  {" >> "} EXPORT_DATA_STREAM_FOR_EXCEL
                </h3>
                <button onClick={() => setShowTSVModal(false)} className="text-emerald-700 hover:text-emerald-400 transition-all p-1">✕</button>
              </div>
              <div className="p-6">
                <textarea
                  readOnly
                  value={generatedTSV}
                  className="w-full h-80 p-4 font-mono text-[9px] bg-emerald-950/10 text-emerald-500 rounded border border-emerald-900/50 focus:ring-1 focus:ring-emerald-500 outline-none leading-relaxed overflow-x-auto shadow-inner"
                  wrap="off"
                />
                <div className="mt-6 flex justify-between items-center">
                   <p className="text-[8px] text-emerald-800 font-medium max-w-xs uppercase tracking-wider">
                     // Data_Ready_For_Buffer_Transfer. Copy_And_Paste_To_Target_Spreadsheet.
                   </p>
                   <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(generatedTSV);
                      setCopyStatus("COPIED");
                      setTimeout(() => setCopyStatus("COPY_BUFFER"), 2000);
                    }}
                    className="bg-emerald-600 text-black px-8 py-2 rounded font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.2)] flex items-center gap-2"
                  >
                    {copyStatus === "COPIED" ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>}
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
