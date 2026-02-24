import { GoogleGenAI, Type } from "@google/genai";
import { ExtractionResult } from "../types";

export const extractInvoiceData = async (
  base64Data: string,
  mimeType: string
): Promise<ExtractionResult> => {
  const apiKey = (import.meta as any).env?.VITE_API_KEY as string | undefined;

  if (!apiKey) {
    throw new Error("Falta VITE_API_KEY en Vercel (Settings → Environment Variables).");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          {
            text: "Extrae de la factura: Proveedor, Fecha (YYYY-MM-DD), Número de factura e Importe total. También genera un 'nombre corto' para el proveedor (una sola palabra distintiva, ej: 'Boston Scientifics' -> 'Boston', 'War Medical' -> 'W. Medical'). Responde en JSON.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          proveedor: { type: Type.STRING },
          shortenedProveedor: { type: Type.STRING, description: "Nombre distintivo corto de una sola palabra" },
          fechaFactura: { type: Type.STRING },
          numeroFactura: { type: Type.STRING },
          importe: { type: Type.NUMBER },
        },
        required: ["proveedor", "shortenedProveedor", "fechaFactura", "numeroFactura", "importe"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  return JSON.parse(jsonStr) as ExtractionResult;
};
