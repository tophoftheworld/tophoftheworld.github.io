/** Re-export inventory Firebase app / Firestore for purchasing. */
import { app, db } from '../../inventory/js/firebase-inventory.js?v=105';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';

export { app, db };

const storage = getStorage(app);

/**
 * Upload a receipt data URL to the same Storage path the Expenses app uses.
 * @returns {Promise<string|null>} public download URL
 */
export async function uploadExpenseReceipt(expenseId, receiptDataUrl) {
  if (!expenseId || !receiptDataUrl || typeof receiptDataUrl !== 'string') return null;
  if (!receiptDataUrl.startsWith('data:')) return null;
  try {
    const mimeMatch = receiptDataUrl.match(/^data:([^;]+);base64,/);
    const contentType = mimeMatch?.[1] || 'image/jpeg';
    const blob = await (await fetch(receiptDataUrl)).blob();
    const fileRef = storageRef(storage, `expense-receipts/${expenseId}`);
    await uploadBytes(fileRef, blob, { contentType });
    return await getDownloadURL(fileRef);
  } catch (err) {
    console.warn('[Purchasing] Receipt upload failed:', err);
    return null;
  }
}

/**
 * Resolve a receipt download URL from Storage (when Firestore only has a flag).
 */
export async function fetchExpenseReceiptUrl(expenseId) {
  if (!expenseId) return null;
  try {
    const fileRef = storageRef(storage, `expense-receipts/${expenseId}`);
    return await getDownloadURL(fileRef);
  } catch (_) {
    return null;
  }
}
