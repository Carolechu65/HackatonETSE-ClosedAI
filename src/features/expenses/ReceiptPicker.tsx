import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { PrimaryAction, typography } from '../../ui/index.ts';
import { prepareReceipt, validateReceiptSize, type PickedReceipt } from './receiptFile.ts';
export type { PickedReceipt } from './receiptFile.ts';

/** System camera/file pickers: receipts stay in the current account's upload flow. */
export function ReceiptPicker({ disabled, onPick }: { disabled: boolean; onPick: (file: PickedReceipt) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const locked = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function pick(camera: boolean) {
    if (disabled || locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    let cached: File | null = null;
    try {
      let selected: PickedReceipt;
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!alive.current) return;
        if (!permission.granted) throw new Error('Permite el acceso a la cámara en los ajustes del móvil, o selecciona una foto o PDF.');
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, base64: true, exif: false });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset?.base64) throw new Error('No se pudo preparar la foto del ticket.');
        cached = new File(asset.uri);
        selected = prepareReceipt(asset.fileName ?? 'ticket.jpg', asset.base64, 'image/jpeg');
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset) return;
        cached = new File(asset.uri);
        validateReceiptSize(cached.size);
        const mimeType = asset.mimeType ?? (/\.pdf$/i.test(asset.name) ? 'application/pdf' : /\.png$/i.test(asset.name) ? 'image/png' : /\.jpe?g$/i.test(asset.name) ? 'image/jpeg' : '');
        selected = prepareReceipt(asset.name, await cached.base64(), mimeType);
      }
      if (alive.current) await onPick(selected);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el ticket. Prueba con otra foto o PDF.');
    } finally {
      // Remove only the picker's app-cache copy, never a user's original document.
      if (cached?.uri.startsWith(Paths.cache.uri)) { try { if (cached.exists) cached.delete(); } catch { /* OS cache cleanup may already have removed it. */ } }
      locked.current = false; if (alive.current) setBusy(false);
    }
  }
  return <View style={{ gap: 10 }}>
    <PrimaryAction label={busy ? 'Preparando ticket…' : 'Hacer foto del ticket'} disabled={disabled || busy} onPress={() => void pick(true)} />
    <PrimaryAction label="Subir foto o PDF" disabled={disabled || busy} onPress={() => void pick(false)} />
    <Text style={typography.support}>JPG, PNG o PDF · Hasta 8 MB. Revisa la lectura antes de guardar el gasto.</Text>
    {error ? <Text accessibilityRole="alert" style={typography.support}>{error}</Text> : null}
  </View>;
}
