import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * En web no existe el módulo nativo de animación: activar `useNativeDriver`
 * provoca un aviso y una caída silenciosa al driver JS. En Android/iOS lo usamos.
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * Respeta «reducir movimiento» del sistema. Con la preferencia activa las entradas
 * aparecen directamente y no se encadenan retardos.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduced(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
