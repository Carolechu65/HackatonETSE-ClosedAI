import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './Icon.tsx';
import { colors, typography } from './theme.ts';
import { USE_NATIVE_DRIVER } from './animation.ts';

const TAB_META: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Tablón', icon: 'home' },
  gastos: { label: 'Gastos', icon: 'credit-card' },
  tareas: { label: 'Tareas', icon: 'check-square' },
  piso: { label: 'Piso', icon: 'users' },
};

/**
 * Barra inferior fija (guía §5.12) con iconos de línea y etiquetas en mayúsculas.
 * La pestaña activa subraya en rojo y su icono crece ligeramente al pulsar.
 */
export type RetroTabBarProps = {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<string, { options?: { title?: string } } | undefined>;
  emitter: {
    emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean };
  };
  navigateToTab: (routeKey: string) => void;
  insets: { bottom: number };
};

export function RetroTabBar({ state, descriptors, emitter, navigateToTab, insets }: RetroTabBarProps) {
  return (
    <View style={{ height: 58 + Math.max(insets.bottom, 16), flexShrink: 0 }}>
    <View nativeID="alarmat-bottom-menu" accessibilityRole="tablist" style={[styles.bar, Platform.OS === 'web' && styles.fixedWeb, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const meta = TAB_META[route.name] ?? { label: route.name, icon: 'circle' as IconName };
        const options = descriptors[route.key]?.options;
        const label = typeof options?.title === 'string' ? options.title : meta.label;

        return (
          <TabItem
            key={route.key}
            label={label}
            icon={meta.icon}
            focused={focused}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
          />
        );
      })}
    </View>
    </View>
  );
}

function TabItem({
  label,
  icon,
  focused,
  onPress,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
}) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      useNativeDriver: USE_NATIVE_DRIVER,
      speed: 28,
      bounciness: 7,
    }).start();
  }, [focused, progress]);

  const color = focused ? colors.tx : colors.mu;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      onPress={onPress}
      style={styles.item}
    >
      <Animated.View
        style={{
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
        }}
      >
        <Icon name={icon} size={18} color={color} />
      </Animated.View>
      <Text style={[typography.tab, { color }]} numberOfLines={1}>{label}</Text>
      <Animated.View
        style={[
          styles.underline,
          {
            opacity: progress,
            transform: [{ scaleX: progress }],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // On web, anchor to the viewport even when the document itself scrolls.
  // The outer spacer keeps the last content row above the menu.
  fixedWeb: { position: 'fixed' as 'absolute', bottom: 0, left: 0, right: 0, width: '100%', maxWidth: 460, marginHorizontal: 'auto', zIndex: 100 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.ln,
    backgroundColor: colors.wall,
    paddingTop: 9,
    paddingHorizontal: 6,
  },
  item: {
    alignItems: 'center',
    gap: 4,
    minWidth: 64,
    minHeight: 48,
    justifyContent: 'center',
    paddingTop: 2,
  },
  underline: {
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.ac,
    marginTop: 1,
  },
});
