export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export type PickedReceipt = { filename: string; base64: string; preview?: string };
export function validateReceiptSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 8 || bytes > MAX_RECEIPT_BYTES) throw new Error('El ticket debe ocupar entre 8 bytes y 8 MB. Usa una foto más pequeña o un PDF de menor tamaño.');
}
export function prepareReceipt(filename: string, base64: string, mediaType: string): PickedReceipt {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mediaType)) throw new Error('Elige un ticket en JPG, PNG o PDF.');
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('No se pudo leer el ticket. Vuelve a seleccionarlo.');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  validateReceiptSize(base64.length * 3 / 4 - padding);
  const extension = mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/png' ? '.png' : '.pdf';
  const stem = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/\.[^.]+$/, '').trim().slice(0, 140) || 'ticket';
  return { filename: stem + extension, base64, ...(mediaType.startsWith('image/') ? { preview: `data:${mediaType};base64,${base64}` } : {}) };
}
