import type { ExpoConfig } from 'expo/config';

/**
 * Configuración Expo (P1).
 *
 * Marca «Nevera Retro»: fuente vectorial en `assets/brand/*.svg`; los PNG se
 * regeneran con `node scripts/brand/render.mjs` (requiere rsvg-convert).
 * El icono activo es la campana; la alternativa `clock` está generada.
 */
const config: ExpoConfig = {
  name: 'alarmaT',
  slug: 'alarmat',
  version: '0.1.0',
  scheme: 'alarmat',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/brand/icon.png',
  android: {
    package: 'com.closedai.alarmat',
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-icon.png',
      backgroundColor: '#efe2c4',
    },
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#efe2c4',
      },
    ],
  ],
};

export default config;
