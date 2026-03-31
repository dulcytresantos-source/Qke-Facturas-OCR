
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  UploadCloud, 
  Trash2, 
  Download, 
  Play, 
  Square, 
  Copy, 
  Check, 
  X, 
  Settings, 
  AlertTriangle,
  Terminal,
  Cpu,
  LayoutDashboard,
  FileSpreadsheet,
  Layers,
  Search,
  Filter,
  ArrowUpDown
} from 'lucide-react';
import { InvoiceData, ProcessingStatus } from './types';
import { extractInvoiceData } from './services/geminiService';
import { fileToBase64, generateTSV, downloadFile, generateRenamedFileName, formatSpanishAmount, formatSpanishDate } from './utils/helpers';

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

  const lastProcessedInvoice = useMemo(() => {
    const completed = invoices.filter(i => i.status === ProcessingStatus.COMPLETED);
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [invoices]);

  const downloadOneRenamed = (inv: InvoiceData) => {
    const file = (window as any)[`file_${inv.internalId}`];
    if (file && inv.renamedFileName) {
      downloadFile(file, inv.renamedFileName, file.type);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      const dataTransfer = new DataTransfer();
      acceptedFiles.forEach(file => dataTransfer.items.add(file));
      addFilesToQueue(dataTransfer.files);
    },
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  } as any);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortConfig.key !== column) return (
      <ArrowUpDown className="w-3 h-3 text-slate-300 ml-2" />
    );
    return sortConfig.direction === 'asc' ? (
      <ArrowUpDown className="w-3 h-3 text-emerald-500 ml-2" />
    ) : (
      <ArrowUpDown className="w-3 h-3 text-emerald-500 ml-2 rotate-180" />
    );
  };

  return (
    <div className="min-h-screen bg-[#020408] text-slate-300 font-sans selection:bg-emerald-500/20 selection:text-emerald-200">
      <div className="max-w-[1600px] mx-auto border-x border-white/5">
        
        {/* Header Section - Dark & Minimal */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-8 border-b border-white/5 p-8">
          <div className="flex items-center gap-6">
            <motion.div 
              initial={{ rotate: -10, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              className="w-16 h-16 bg-slate-900 rounded-none flex items-center justify-center border border-white/10"
            >
              <Cpu className="w-10 h-10 text-[#00f2ff]" strokeWidth={2} />
            </motion.div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white leading-none">
                INVOICE<span className="text-[#00f2ff]">AI</span>
              </h1>
              <p className="text-slate-500 font-bold text-[10px] uppercase tracking-[0.4em] mt-2">
                Neural Data Extraction Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">System Status</p>
              <div className="flex items-center gap-2 justify-end">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-none animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Active</span>
              </div>
            </div>
            <div className="h-10 w-[1px] bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-3 bg-slate-900/50 px-5 py-2.5 rounded-none border border-white/10">
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">v2.5.0</span>
            </div>
          </div>
        </header>

        {/* Main Content Blocks */}
        <div className="flex flex-col">
          {/* Top Section: Dropzone & Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 border-b border-white/5">
            {/* Dropzone (Small) */}
            <div className="lg:col-span-3">
              <div
                {...getRootProps()}
                className={`matrix-bg rounded-none border matrix-border p-6 h-full min-h-[180px] transition-all duration-500 cursor-pointer overflow-hidden flex flex-col items-center justify-center gap-4 group
                  ${isDragActive ? 'border-[#00f2ff]' : 'hover:border-[#00f2ff]/40'}
                `}
              >
                <input {...getInputProps()} />
                <div className={`w-12 h-12 rounded-none border border-white/10 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-colors group-hover:border-[#00f2ff]/30
                  ${isDragActive ? 'text-[#00f2ff] border-[#00f2ff]' : 'text-slate-600'}
                `}>
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-black matrix-text uppercase tracking-widest">Drop Here</p>
                  <p className="text-[9px] text-slate-600 font-mono mt-1">PDF / JPG / PNG</p>
                </div>
              </div>
            </div>

            {/* Controls & Stats */}
            <div className="lg:col-span-9">
              <div className="bg-slate-900/40 p-6 rounded-none border border-white/5 h-full flex flex-col justify-between gap-6 border-l-0">
                <div className="flex flex-wrap items-center justify-between gap-6">
                  <div className="flex gap-3">
                    <button onClick={processAllInvoices} disabled={isBatchProcessing || invoices.length === 0} className="h-12 px-6 bg-emerald-600 text-white rounded-none font-black text-xs uppercase tracking-widest hover:bg-emerald-500 transition-all flex items-center gap-2 disabled:opacity-30">
                      <Play className="w-4 h-4" fill="currentColor" /> Ejecutar
                    </button>
                    <button onClick={() => { const tsv = generateTSV(invoices, tempMonth, lastSeqNum); setGeneratedTSV(tsv); setShowTSVModal(true); }} disabled={isBatchProcessing || invoices.length === 0} className="h-12 px-6 bg-slate-800 text-white rounded-none font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition-all flex items-center gap-2 disabled:opacity-30">
                      <FileSpreadsheet className="w-4 h-4" /> Exportar
                    </button>
                    <button onClick={handleReset} disabled={isBatchProcessing || invoices.length === 0} className="h-12 px-6 bg-slate-800 text-slate-400 rounded-none font-black text-xs uppercase tracking-widest hover:bg-rose-900/20 hover:text-rose-400 transition-all flex items-center gap-2 disabled:opacity-30">
                      <Trash2 className="w-4 h-4" /> Reset
                    </button>
                  </div>

                  <div className="flex gap-4">
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Total</p>
                      <p className="text-xl font-black text-white leading-none">{invoices.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Ready</p>
                      <p className="text-xl font-black text-emerald-500 leading-none">{invoices.filter(i => i.status === ProcessingStatus.COMPLETED).length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">Importe</p>
                      <p className="text-xl font-black text-indigo-400 leading-none">
                        {invoices.filter(i => i.status === ProcessingStatus.COMPLETED).reduce((s, i) => s + i.importe, 0).toLocaleString('es-ES')}€
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-none bg-emerald-500/10 flex items-center justify-center">
                      <FileText className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Última Factura</p>
                      <p className="text-[11px] font-bold text-slate-300 truncate max-w-[200px]">
                        {lastProcessedInvoice ? `${lastProcessedInvoice.proveedor} • ${formatSpanishAmount(lastProcessedInvoice.importe)}` : 'Esperando...'}
                      </p>
                    </div>
                  </div>
                  {invoices.some(i => i.isDuplicate) && (
                    <button onClick={handleCleanDuplicates} className="px-4 py-2 bg-rose-500/10 text-rose-500 rounded-none text-[9px] font-black uppercase tracking-widest hover:bg-rose-500/20 transition-colors border border-rose-500/20">
                      Limpiar Duplicados
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Console Listing Area */}
          <div className="matrix-bg rounded-none border-x border-b matrix-border overflow-hidden">
          <div className="px-8 py-4 border-b matrix-border flex items-center justify-between bg-black/20">
            <div className="flex items-center gap-3">
              <Terminal className="w-4 h-4 text-[#00f2ff]" />
              <span className="text-[10px] font-black matrix-text uppercase tracking-[0.3em]">Console_Output_Registry</span>
            </div>
            <div className="flex gap-4">
              <span className="text-[9px] font-mono text-slate-600">PDF</span>
              <span className="text-[9px] font-mono text-slate-600">JPG</span>
              <span className="text-[9px] font-mono text-slate-600">PNG</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono">
              <thead>
                <tr className="border-b matrix-border bg-black/40">
                  <th className="px-8 py-4 console-label cursor-pointer" onClick={() => handleSort('fileName')}>
                    <div className="flex items-center gap-2">DOC <SortIcon column="fileName" /></div>
                  </th>
                  <th className="px-8 py-4 console-label cursor-pointer" onClick={() => handleSort('proveedor')}>
                    <div className="flex items-center gap-2">ALIAS <SortIcon column="proveedor" /></div>
                  </th>
                  <th className="px-8 py-4 console-label cursor-pointer" onClick={() => handleSort('fechaFactura')}>
                    <div className="flex items-center gap-2">FECHA <SortIcon column="fechaFactura" /></div>
                  </th>
                  <th className="px-8 py-4 console-label text-right cursor-pointer" onClick={() => handleSort('importe')}>
                    <div className="flex items-center justify-end gap-2">IMPORTE <SortIcon column="importe" /></div>
                  </th>
                  <th className="px-8 py-4 console-label">DOC_EXT</th>
                  <th className="px-8 py-4 console-label text-center">CMD</th>
                </tr>
              </thead>
              <tbody className="divide-y border-white/5">
                <AnimatePresence mode="popLayout">
                  {sortedInvoices.length === 0 ? (
                    <tr key="empty">
                      <td colSpan={6} className="px-8 py-20 text-center opacity-20">
                        <p className="text-xs font-mono uppercase tracking-widest">No data in buffer</p>
                      </td>
                    </tr>
                  ) : (
                    sortedInvoices.map((inv) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={inv.internalId} 
                        className={`console-row ${inv.isDuplicate ? 'bg-rose-500/5' : ''}`}
                      >
                        <td className="px-8 py-4">
                          <span className="text-[#00f2ff] font-bold text-xs">{inv.numeroFactura || '---'}</span>
                        </td>
                        <td className="px-8 py-4">
                          <span className="text-slate-300 text-xs uppercase">{inv.proveedor || '---'}</span>
                        </td>
                        <td className="px-8 py-4">
                          <span className="text-slate-500 text-xs">{formatSpanishDate(inv.fechaFactura)}</span>
                        </td>
                        <td className="px-8 py-4 text-right">
                          <span className="text-emerald-500 font-bold text-xs">{formatSpanishAmount(inv.importe)}</span>
                        </td>
                        <td className="px-8 py-4">
                          <span className="text-slate-600 text-[10px] truncate max-w-[150px] block">{inv.fileName}</span>
                        </td>
                        <td className="px-8 py-4">
                          <div className="flex items-center justify-center gap-3">
                            {inv.status === ProcessingStatus.COMPLETED ? (
                              <span className="badge-ok">OK</span>
                            ) : inv.status === ProcessingStatus.PROCESSING ? (
                              <span className="badge-ocr">OCR...</span>
                            ) : inv.status === ProcessingStatus.FAILED ? (
                              <span className="badge-err">ERR</span>
                            ) : (
                              <span className="text-[10px] text-slate-700">WAIT</span>
                            )}
                            <button onClick={() => removeInvoice(inv.internalId)} className="text-slate-700 hover:text-rose-500 transition-colors">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* TSV Modal */}
        <AnimatePresence>
          {showTSVModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-slate-900 rounded-none w-full max-w-5xl overflow-hidden border border-white/10"
              >
                <div className="px-12 py-10 border-b border-white/5 flex items-center justify-between bg-black/20">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-emerald-600 text-white rounded-none flex items-center justify-center border border-emerald-500/30">
                      <FileSpreadsheet className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="font-black text-white uppercase text-3xl tracking-tight">Exportar Datos</h3>
                      <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">TSV para Excel / Sheets</p>
                    </div>
                  </div>
                  <button onClick={() => setShowTSVModal(false)} className="p-4 text-slate-500 hover:text-rose-500 transition-colors">
                    <X className="w-8 h-8" />
                  </button>
                </div>
                <div className="p-12 space-y-10">
                  <textarea
                    readOnly
                    value={generatedTSV}
                    className="w-full h-[400px] p-8 font-mono text-base bg-black/40 text-emerald-400 rounded-none border border-white/5 outline-none leading-relaxed overflow-x-auto shadow-inner"
                    wrap="off"
                  />
                  <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                    <p className="text-slate-500 font-bold uppercase tracking-widest text-sm max-w-md">
                      Copia estos datos y pégalos directamente en tu hoja de cálculo favorita.
                    </p>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(generatedTSV);
                        setCopyStatus("¡COPIADO!");
                        setTimeout(() => setCopyStatus("COPIAR DATOS"), 2000);
                      }}
                      className="h-20 px-12 bg-emerald-600 text-white rounded-none font-black text-2xl uppercase tracking-widest hover:bg-emerald-500 transition-all flex items-center gap-4 border border-emerald-500/30"
                    >
                      {copyStatus === "¡COPIADO!" ? <Check className="w-8 h-8" /> : <Copy className="w-8 h-8" />}
                      {copyStatus}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
