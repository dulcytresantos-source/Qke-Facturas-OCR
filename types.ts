
export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface InvoiceData {
  internalId: string;
  proveedor: string;
  shortenedProveedor: string;
  fechaFactura: string;
  numeroFactura: string;
  importe: number;
  fileName: string; // Nombre original del archivo subido
  status: ProcessingStatus;
  isDuplicate?: boolean;
  duplicateOfName?: string; // Nombre original del archivo que ya existía
  renamedFileName?: string;
  isAlreadyRenamed?: boolean;
  nif?: string;
  error?: string;
}

export interface ExtractionResult {
  proveedor: string;
  shortenedProveedor: string;
  fechaFactura: string;
  numeroFactura: string;
  importe: number;
  nif: string;
}
