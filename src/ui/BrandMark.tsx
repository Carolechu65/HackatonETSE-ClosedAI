import { Image } from 'react-native';

/**
 * Logotipo de alarmaT (etiqueta con la casilla y la X a pluma).
 * PNG con transparencia generado desde `alarmat-logo.svg`; se adapta al fondo
 * de la puerta y a la barra lateral sin caja visible.
 */
const LOGO = require('../../assets/brand/alarmat-logo.png');
const RATIO = 361 / 1200;

export function BrandMark({ width = 176 }: { width?: number }) {
  return (
    <Image
      source={LOGO}
      style={{ width, height: Math.round(width * RATIO) }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="alarmaT, alarmas compartidas"
    />
  );
}
