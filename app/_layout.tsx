import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, fontFamily, useNeveraFonts } from '../src/ui/index.ts';

/**
 * Layout raíz (P1): puerta de nevera de fondo, tipografías del estilo y cabecera
 * cálida. Las rutas delegan en `src/features`; aquí no hay reglas de negocio.
 */
export default function RootLayout() {
  const { loaded } = useNeveraFonts();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: colors.wall }}>
        {loaded ? (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.wall },
              headerShadowVisible: false,
              headerTintColor: colors.tx,
              headerTitleStyle: { fontFamily: fontFamily.display, color: colors.tx, fontSize: 20 },
              contentStyle: { backgroundColor: colors.wall },
            }}
          />
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}
