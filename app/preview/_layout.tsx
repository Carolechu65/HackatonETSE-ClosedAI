import { Tabs } from 'expo-router';
import { SkeletonProvider } from '../../src/features/skeleton/store.tsx';
import { RetroTabBar } from '../../src/ui/index.ts';
import { colors } from '../../src/ui/tokens.ts';

/**
 * Menús principales (P1): cuatro pestañas con barra inferior propia.
 * Cada pantalla ocupa el alto disponible sin scroll; la barra no se mueve.
 */
export default function TabsLayout() {
  return (
    <SkeletonProvider><Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.wall },
        animation: 'shift',
      }}
      tabBar={(props) => (
        <RetroTabBar
          state={props.state}
          descriptors={props.descriptors}
          emitter={props.emitter}
          navigateToTab={props.navigateToTab}
          insets={props.insets}
        />
      )}
    >
      <Tabs.Screen name="index" options={{ title: 'Tablón' }} />
      <Tabs.Screen name="gastos" options={{ title: 'Gastos' }} />
      <Tabs.Screen name="tareas" options={{ title: 'Tareas' }} />
      <Tabs.Screen name="piso" options={{ title: 'Piso' }} />
    </Tabs></SkeletonProvider>
  );
}
