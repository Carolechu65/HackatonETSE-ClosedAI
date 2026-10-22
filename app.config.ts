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
  // A subdirectory is only used by the VPS web export, never native deep links.
  experiments: { baseUrl: process.env.ALARMAT_WEB_BASE_PATH || undefined },
  web: { output: 'single' },
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/brand/icon.png',
  android: {
    package: 'com.closedai.alarmat',
    // A restored native alarm store must never execute an old device's consent.
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/brand/adaptive-icon.png', backgroundColor: '#efe2c4' },
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/brand/splash-icon.png', imageWidth: 220, resizeMode: 'contain', backgroundColor: '#efe2c4' }],
    'expo-sqlite',
    'expo-secure-store',
    'expo-notifications',
    /*
     * P6 · widget de la próxima alarma. Requiere development build nueva:
     * el plugin genera el receptor/launcher de Android. Ver handoff de P1.
     */
    [
      'expo-widgets',
      {
        enableAndroid: true,
        widgets: [
          {
            name: 'AlarmaTWidget',
            displayName: 'AlarmaT',
            description: 'Próxima alarma, propuestas pendientes y estado de sincronización.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
            android: {
              targetCellWidth: 4,
              targetCellHeight: 3,
              resizeMode: 'horizontal',
              initialLayout: './src/widgets/AlarmaTWidget.tsx',
            },
          },
        ],
      },
    ],
    './plugins/with-widget-links.cjs',
    './plugins/with-release-signing.cjs',
  ],
};

export default config;
