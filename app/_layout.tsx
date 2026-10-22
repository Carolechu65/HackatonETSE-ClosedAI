import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SkeletonProvider } from '../src/features/skeleton/store.tsx';
import { colors, useNeveraFonts } from '../src/ui/index.ts';

/**
 * Layout raíz (P1): puerta de nevera de fondo, tipografías del estilo y estado
 * compartido del esqueleto. Las rutas delegan en `app/(tabs)`; aquí no hay reglas
 * de negocio ni llamadas a Firebase.
 */
export default function RootLayout() {
  const { loaded } = useNeveraFonts();

  return (
    <SafeAreaProvider>
      <SkeletonProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.wall }}>
          {loaded ? (
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.wall },
              }}
            />
          ) : null}
        </View>
      </SkeletonProvider>
    </SafeAreaProvider>
  );
}
