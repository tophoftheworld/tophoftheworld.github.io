/**
 * Vision proxy base URL (Node app: receipt-ocr/server → npm start, default port 8787).
 *
 * This is NOT your static site URL. If you open the UI at e.g.
 * http://localhost:8080/receipt-ocr/ leave this as http://localhost:8787 (same PC).
 * Only change it if the bridge runs elsewhere, e.g. http://192.168.1.10:8787
 */
export const RECEIPT_OCR_API_BASE =
  typeof window !== 'undefined' && window.__RECEIPT_OCR_API_BASE__
    ? window.__RECEIPT_OCR_API_BASE__
    : 'http://localhost:8787';
