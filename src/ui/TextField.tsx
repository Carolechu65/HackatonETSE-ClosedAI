import { StyleSheet, TextInput, type StyleProp, type TextStyle } from 'react-native';
import { fontFamily } from './fonts.ts';
import { colors, typography } from './theme.ts';

export type TextFieldProps = {
  value: string;
  editable?: boolean;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSubmitEditing?: () => void;
  keyboardType?: 'default' | 'decimal-pad' | 'numeric';
  maxLength?: number;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  /** `on-note` usa el color de texto de las notas; `on-door`, el de la puerta. */
  tone?: 'on-note' | 'on-door';
};

/** Campo de texto sin caja: solo una línea inferior de 1 px (guía §6.3). */
export function TextField({
  value,
  editable = true,
  multiline = false,
  onChangeText,
  placeholder,
  onSubmitEditing,
  keyboardType = 'default',
  maxLength = 80,
  style,
  accessibilityLabel,
  tone = 'on-note',
}: TextFieldProps) {
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel ?? placeholder}
      value={value}
      editable={editable}
      multiline={multiline}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmitEditing}
      placeholder={placeholder}
      placeholderTextColor={colors.mu}
      selectionColor={colors.ac}
      keyboardType={keyboardType}
      maxLength={maxLength}
      returnKeyType="done"
      style={[styles.input, tone === 'on-door' && styles.onDoor, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    ...typography.field,
    fontFamily: fontFamily.display,
    fontSize: 20,
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.noteLine,
    color: colors.ntx,
  },
  onDoor: {
    color: colors.tx,
    borderBottomColor: colors.ln,
  },
});
