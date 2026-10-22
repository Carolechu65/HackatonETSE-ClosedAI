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
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.WAKE_LOCK',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.VIBRATE',
    ],
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-icon.png',
      backgroundColor: '#efe2c4',
    },
  },
  plugins: [
    'expo-router',
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
