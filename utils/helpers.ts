
import { InvoiceData } from "../types";

export const formatSpanishAmount = (amount: number): string => {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

export const formatSpanishDate = (dateStr: string): string => {
  if (!dateStr || dateStr === '-') return '-';
  // Gemini returns YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

/**
 * Genera el código NDoc (ej: 09-FC01)
 * @param invoice Datos de la factura
 * @param index Índice de la factura válida en la tanda actual
 * @param templateMonth Mes fijo opcional (ej: "01")
 * @param lastSequence Nº de la última factura procesada (ej: 20)
 */
export const getNDoc = (
  invoice: InvoiceData, 
  index: number, 
  templateMonth?: string, 
  lastSequence?: number
): string => {
  // Determinamos el mes: del template o de la factura
  let month = templateMonth?.padStart(2, '0') || "";
  
  if (!month || month === "00") {
    const dateStr = invoice.fechaFactura;
    const date = new Date(dateStr);
    month = isNaN(date.getTime()) ? "00" : String(date.getMonth() + 1).padStart(2, '0');
  }
  
  const baseSeq = lastSequence || 0;
  const nextSeq = baseSeq + index + 1;
  const seqStr = String(nextSeq).padStart(2, '0');
  
  return `${month}-FC${seqStr}`;
};

export const generateRenamedFileName = (
  invoice: InvoiceData, 
  index: number, 
  originalFileName: string,
  templateMonth?: string,
  lastSequence?: number
): string => {
  const ndoc = getNDoc(invoice, index, templateMonth, lastSequence);
  const shortName = invoice.shortenedProveedor || "PROVEEDOR";
  const formattedAmount = formatSpanishAmount(invoice.importe);
  const extension = originalFileName.split('.').pop() || "pdf";
  
  return `${ndoc} ${shortName} ${formattedAmount}€.${extension}`;
};

export const fileToBase64 = (file: File): Promise<{ data: string; mimeType: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      resolve({ data: base64Data, mimeType: file.type });
    };
    reader.onerror = error => reject(error);
  });
};

export const generateTSV = (
  invoices: InvoiceData[], 
  templateMonth?: string, 
  lastSequence?: number
): string => {
  const headers = ["Identificador", "Nombre Proveedor", "NIF", "Número Factura", "Fecha Factura", "Importe", "Estado"];
  let validIndexCounter = 0;

  const rows = invoices
    .filter(inv => inv.status === 'COMPLETED')
    .map((inv) => {
      let currentNDoc = "";
      
      if (!inv.isDuplicate) {
        currentNDoc = getNDoc(inv, validIndexCounter, templateMonth, lastSequence);
        validIndexCounter++;
      }

      const formattedAmount = formatSpanishAmount(inv.importe);
      const identifier = inv.isDuplicate 
        ? `DUPLICADO-${inv.duplicateOfName}` 
        : `${currentNDoc} ${inv.shortenedProveedor} ${formattedAmount}`;
      
      return [
        identifier,
        inv.proveedor,
        inv.nif || "-",
        inv.numeroFactura,
        formatSpanishDate(inv.fechaFactura),
        formattedAmount,
        inv.isDuplicate ? `DUPLICADO DE: ${inv.duplicateOfName}` : "OK"
      ];
    });

  return [headers, ...rows].map(e => e.join("\t")).join("\n");
};

export const downloadFile = (content: string | Blob, fileName: string, mimeType: string) => {
  const blob = content instanceof Blob ? content : new Blob(["\uFEFF" + content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
