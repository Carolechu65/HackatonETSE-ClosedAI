/**
 * Tipografías del estilo «Nevera Retro».
 *
 * Fraunces para títulos, DM Mono para datos y etiquetas. Se cargan en el layout
 * raíz; si fallan, el sistema usa la pila de respaldo (`serif` / `monospace`) y
 * la app sigue siendo legible. No añadir una tercera familia.
 */
import { useFonts } from 'expo-font';
import { Fraunces_400Regular, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { DMMono_300Light, DMMono_400Regular } from '@expo-google-fonts/dm-mono';

/** Nombres registrados por expo-font. Deben coincidir con `useNeveraFonts`. */
export const fontFamily = {
  display: 'Fraunces_400Regular',
  displayStrong: 'Fraunces_600SemiBold',
  body: 'DMMono_300Light',
  bodyStrong: 'DMMono_400Regular',
} as const;

export function useNeveraFonts(): { loaded: boolean; error: Error | null } {
  const [loaded, error] = useFonts({
    [fontFamily.display]: Fraunces_400Regular,
    [fontFamily.displayStrong]: Fraunces_600SemiBold,
    [fontFamily.body]: DMMono_300Light,
    [fontFamily.bodyStrong]: DMMono_400Regular,
  });
  return { loaded, error: error ?? null };
}
