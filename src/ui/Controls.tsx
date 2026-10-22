import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, typography, layout, paper } from './theme.ts';

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={styles.fieldWrap}>
    <Text style={typography.labelOnNote}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={colors.mu} {...props} style={[styles.input, props.style]} />
    {hint ? <Text style={typography.support}>{hint}</Text> : null}
  </View>;
}
export function Action({ children, onPress, disabled, selected, style, label }: { children: ReactNode; onPress: () => void; disabled?: boolean; selected?: boolean; style?: StyleProp<ViewStyle>; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!selected }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.action, selected && styles.selected, pressed && { opacity: 0.65 }, disabled && { opacity: 0.45 }, style]}>
    <Text style={[typography.bodyOnDoor, { textAlign: 'center', flexShrink: 1 }, selected && { color: colors.onAvatar }]}>{children}</Text>
  </Pressable>;
}
export function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
    <Text style={[typography.body, selected && { color: colors.onAvatar }]}>{label}</Text>
  </Pressable>;
}
export function Avatar({ name, selected = false, size = 36 }: { name: string; selected?: boolean; size?: number }) {
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, selected && styles.selected]}><Text style={[typography.body, selected && { color: colors.onAvatar }]}>{name.slice(0, 1).toUpperCase()}</Text></View>;
}
export function Message({ text, error = false }: { text: string | null; error?: boolean }) {
  if (!text) return null;
  return <View accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: error ? paper[2] : paper[4] }]}><Text style={typography.body}>{text}</Text></View>;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar. Vuelve a intentarlo.'); }
    finally { locked.current = false; setBusy(false); }
  };
  return { busy, error, run, setError };
}
const styles = StyleSheet.create({
  fieldWrap: { minWidth: 0, gap: 8, marginVertical: 6 },
  input: { ...typography.field, fontSize: 16, lineHeight: 24, borderBottomWidth: 1, borderBottomColor: colors.noteLine, paddingVertical: 10, minHeight: 48, outlineWidth: 0 },
  action: { minHeight: layout.minTouchTarget, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderColor: colors.ln, borderWidth: 1, borderRadius: 2 },
  selected: { backgroundColor: colors.ntx },
  choice: { minHeight: 48, maxWidth: '100%', justifyContent: 'center', borderWidth: 1, borderColor: colors.noteLine, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 2 },
  choiceSelected: { backgroundColor: colors.ntx },
  avatar: { borderWidth: 1, borderColor: colors.ntx, alignItems: 'center', justifyContent: 'center', backgroundColor: paper[4] },
  message: { padding: 12, borderRadius: 2 },
});
