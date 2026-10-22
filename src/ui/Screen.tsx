import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout } from './theme.ts';

export type ScreenProps = {
  children: ReactNode;
  /** Usar scroll para tablones y formularios largos. */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/** La puerta de la nevera: fondo plano `wall` y margen lateral de 18 px. */
export function Screen({ children, scroll = false, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView style={styles.door} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  door: {
    flex: 1,
    backgroundColor: colors.wall,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.gutter,
    paddingBottom: 24,
    gap: layout.noteGapRow,
  },
});
