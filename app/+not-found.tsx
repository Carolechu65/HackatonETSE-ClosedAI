import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { PrimaryAction, Screen, ScreenHeader, Sheet, typography } from '../src/ui/index.ts';

/** Ruta común de P1: un enlace roto no debe dejar al usuario en una pantalla vacía. */
export default function NotFoundRoute() {
  const router = useRouter();

  return (
    <Screen scroll>
      <ScreenHeader eyebrow="LA PUERTA DE LA NEVERA" title="No está aquí" />
      <Sheet>
        <Text style={typography.detailTitle}>Esta nota se despegó.</Text>
        <Text style={typography.body}>
          El enlace apunta a una pantalla que no existe o a una propuesta que ya se retiró.
        </Text>
      </Sheet>
      <PrimaryAction label="Volver al tablón" onPress={() => router.replace('/')} />
    </Screen>
  );
}
