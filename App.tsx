
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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      <div className="max-w-[1400px] mx-auto p-6 md:p-10 lg:p-16 space-y-12">
        
        {/* Header Section - Large & Professional */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-8 border-b border-slate-200 pb-12">
          <div className="flex items-center gap-6">
            <motion.div 
              initial={{ rotate: -10, scale: 0.9 }}
              animate={{ rotate: 0, scale: 1 }}
              className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center shadow-2xl shadow-slate-200"
            >
              <Cpu className="w-12 h-12 text-emerald-400" strokeWidth={2} />
            </motion.div>
            <div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900 leading-none">
                INVOICE<span className="text-emerald-600">AI</span>
              </h1>
              <p className="text-slate-400 font-bold text-sm uppercase tracking-[0.4em] mt-2">
                Enterprise Data Extraction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
              <div className="flex items-center gap-2 justify-end">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm font-black text-emerald-600 uppercase tracking-widest">System Online</span>
              </div>
            </div>
            <div className="h-12 w-[1px] bg-slate-200 hidden sm:block" />
            <div className="flex items-center gap-3 bg-white px-6 py-3 rounded-2xl border border-slate-200 shadow-sm">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                <Settings className="w-4 h-4 text-slate-500" />
              </div>
              <span className="text-xs font-black text-slate-600 uppercase tracking-widest">v2.5.0</span>
            </div>
          </div>
        </header>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left: Matrix Console Dropzone */}
          <div className="lg:col-span-8 space-y-8">
            <div className="relative group">
              <div className="absolute -inset-1 bg-emerald-500/20 rounded-[40px] blur-xl opacity-0 group-hover:opacity-100 transition duration-500"></div>
              <div
                {...getRootProps()}
                className={`relative matrix-bg rounded-[40px] border-2 matrix-border p-16 transition-all duration-500 cursor-pointer overflow-hidden
                  ${isDragActive ? 'scale-[1.02] border-emerald-400' : 'hover:scale-[1.01]'}
                `}
              >
                <input {...getInputProps()} />
                
                {/* Matrix Rain Decoration */}
                <div className="absolute inset-0 opacity-5 pointer-events-none font-mono text-[8px] leading-none select-none">
                  {Array(30).fill(0).map((_, i) => (
                    <div key={i} className="whitespace-nowrap overflow-hidden">
                      {Math.random().toString(2).substring(2, 100)}
                    </div>
                  ))}
                </div>

                <div className="relative z-10 flex flex-col items-center gap-10">
                  <motion.div
                    animate={isBatchProcessing ? { rotate: 360 } : {}}
                    transition={isBatchProcessing ? { repeat: Infinity, duration: 3, ease: "linear" } : {}}
                    className={`w-32 h-32 rounded-full border-2 matrix-border flex items-center justify-center bg-black/40 backdrop-blur-sm
                      ${isDragActive ? 'text-emerald-400 border-emerald-400' : 'text-emerald-500/40'}
                    `}
                  >
                    {isBatchProcessing ? (
                      <Terminal className="w-16 h-16" />
                    ) : (
                      <UploadCloud className="w-16 h-16" />
                    )}
                  </motion.div>

                  <div className="text-center space-y-4">
                    <h2 className="text-4xl font-black matrix-text uppercase tracking-tighter">
                      {isBatchProcessing ? "Procesando Lote..." : isDragActive ? "Soltar Archivos" : "Consola de Carga"}
                    </h2>
                    <p className="text-emerald-500/50 font-mono text-lg uppercase tracking-widest">
                      {isBatchProcessing ? "Analizando estructuras neuronales" : "PDF / JPG / PNG"}
                    </p>
                  </div>

                  {isBatchProcessing && (
                    <div className="w-full max-w-md space-y-3">
                      <div className="flex justify-between text-[10px] matrix-text uppercase font-bold tracking-widest">
                        <span>Progreso de Secuencia</span>
                        <span>{Math.round((invoices.filter(i => i.status === ProcessingStatus.COMPLETED).length / invoices.length) * 100 || 0)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-emerald-950 rounded-full overflow-hidden border border-emerald-500/20">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(invoices.filter(i => i.status === ProcessingStatus.COMPLETED).length / invoices.length) * 100}%` }}
                          className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Control Center */}
          <div className="lg:col-span-4 space-y-8">
            <div className="bg-white p-10 rounded-[40px] border border-slate-200 shadow-strong h-full flex flex-col justify-between">
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center">
                    <LayoutDashboard className="w-6 h-6 text-slate-900" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Panel de Control</h3>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={processAllInvoices}
                    disabled={isBatchProcessing || invoices.length === 0}
                    className="btn-primary w-full"
                  >
                    <Play className="w-6 h-6" fill="currentColor" />
                    Ejecutar
                  </button>
                  
                  <button
                    onClick={() => {
                      const tsv = generateTSV(invoices, tempMonth, lastSeqNum);
                      setGeneratedTSV(tsv);
                      setShowTSVModal(true);
                    }}
                    disabled={isBatchProcessing || invoices.length === 0}
                    className="btn-secondary w-full"
                  >
                    <FileSpreadsheet className="w-6 h-6" />
                    Exportar
                  </button>

                  <button
                    onClick={handleReset}
                    disabled={isBatchProcessing || invoices.length === 0}
                    className="btn-danger w-full"
                  >
                    <Trash2 className="w-6 h-6" />
                    Reiniciar
                  </button>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-100 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Documentos</span>
                  <span className="text-lg font-black text-slate-900">{invoices.length}</span>
                </div>
                {invoices.some(i => i.isDuplicate) && (
                  <button
                    onClick={handleCleanDuplicates}
                    className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Limpiar Duplicados
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Section - Proportional */}
        <div className="bg-white rounded-[40px] border border-slate-200 shadow-soft p-2">
          <StatsCards invoices={invoices} />
        </div>

        {/* Table Section - Full Width & Proportional */}
        <div className="bg-white rounded-[40px] border border-slate-200 shadow-strong overflow-hidden">
          <div className="px-10 py-8 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Layers className="w-6 h-6 text-slate-400" />
              <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Registro de Facturas</h3>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded-full" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Procesado</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-slate-200 rounded-full" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pendiente</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-10 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest cursor-pointer group" onClick={() => handleSort('fileName')}>
                    <div className="flex items-center gap-2">Archivo <SortIcon column="fileName" /></div>
                  </th>
                  <th className="px-10 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest cursor-pointer group" onClick={() => handleSort('proveedor')}>
                    <div className="flex items-center gap-2">Proveedor <SortIcon column="proveedor" /></div>
                  </th>
                  <th className="px-10 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest cursor-pointer group" onClick={() => handleSort('fechaFactura')}>
                    <div className="flex items-center gap-2">Fecha <SortIcon column="fechaFactura" /></div>
                  </th>
                  <th className="px-10 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-right cursor-pointer group" onClick={() => handleSort('importe')}>
                    <div className="flex items-center justify-end gap-2">Importe <SortIcon column="importe" /></div>
                  </th>
                  <th className="px-10 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <AnimatePresence mode="popLayout">
                  {sortedInvoices.length === 0 ? (
                    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} key="empty">
                      <td colSpan={5} className="px-10 py-32 text-center">
                        <div className="flex flex-col items-center gap-6 opacity-20">
                          <FileText className="w-20 h-20 text-slate-400" strokeWidth={1} />
                          <p className="text-xl font-black uppercase tracking-[0.4em] text-slate-500">Sin Documentos</p>
                        </div>
                      </td>
                    </motion.tr>
                  ) : (
                    sortedInvoices.map((inv) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={inv.internalId} 
                        className={`group transition-all hover:bg-slate-50/80 ${inv.isDuplicate ? 'bg-rose-50/30' : ''}`}
                      >
                        <td className="px-10 py-8">
                          <div className="flex items-center gap-5">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm
                              ${inv.status === ProcessingStatus.COMPLETED ? 'bg-emerald-100 text-emerald-600' : 
                                inv.status === ProcessingStatus.FAILED ? 'bg-rose-100 text-rose-600' : 
                                'bg-slate-100 text-slate-400'}
                            `}>
                              <FileText className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-black text-slate-800 truncate max-w-[250px] text-lg leading-tight">{inv.fileName}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{inv.status}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-8">
                          <span className="font-black text-slate-900 uppercase tracking-tight text-lg">{inv.proveedor || '---'}</span>
                        </td>
                        <td className="px-10 py-8">
                          <span className="font-bold text-slate-500 text-lg">{formatSpanishDate(inv.fechaFactura)}</span>
                        </td>
                        <td className="px-10 py-8 text-right">
                          <span className="font-black text-emerald-600 text-2xl tracking-tighter">{formatSpanishAmount(inv.importe)}</span>
                        </td>
                        <td className="px-10 py-8">
                          <div className="flex items-center justify-center gap-3">
                            <button
                              onClick={() => downloadOneRenamed(inv)}
                              className="p-4 bg-white border border-slate-200 text-slate-400 rounded-2xl hover:text-emerald-600 hover:border-emerald-300 hover:shadow-lg transition-all active:scale-90"
                              title="Descargar"
                            >
                              <Download className="w-6 h-6" />
                            </button>
                            <button
                              onClick={() => removeInvoice(inv.internalId)}
                              className="p-4 bg-white border border-slate-200 text-slate-400 rounded-2xl hover:text-rose-600 hover:border-rose-300 hover:shadow-lg transition-all active:scale-90"
                              title="Eliminar"
                            >
                              <Trash2 className="w-6 h-6" />
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

        {/* TSV Modal */}
        <AnimatePresence>
          {showTSVModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-md">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-[48px] shadow-2xl w-full max-w-5xl overflow-hidden"
              >
                <div className="px-12 py-10 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-emerald-600 text-white rounded-2xl flex items-center justify-center">
                      <FileSpreadsheet className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900 uppercase text-3xl tracking-tight">Exportar Datos</h3>
                      <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">TSV para Excel / Sheets</p>
                    </div>
                  </div>
                  <button onClick={() => setShowTSVModal(false)} className="p-4 text-slate-300 hover:text-rose-500 transition-colors">
                    <X className="w-8 h-8" />
                  </button>
                </div>
                <div className="p-12 space-y-10">
                  <textarea
                    readOnly
                    value={generatedTSV}
                    className="w-full h-[400px] p-8 font-mono text-base bg-slate-900 text-emerald-400 rounded-3xl border-none outline-none leading-relaxed overflow-x-auto shadow-inner"
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
                      className="btn-primary px-12 h-20 text-2xl"
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
