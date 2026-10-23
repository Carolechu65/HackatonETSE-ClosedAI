import type { ExpoConfig } from 'expo/config';

/**
 * Configuración Expo (P1).
 *
 * Marca «Nevera Retro»: fuente vectorial en `assets/brand/*.svg`; los PNG se
 * regeneran con `node scripts/brand/render.mjs` (rsvg-convert o ImageMagick).
 * Icono activo: casilla + X del logo P1; campana y reloj se conservan como alternativas.
 */
const config: ExpoConfig = {
  name: 'alarmaT',
  slug: 'alarmat',
  version: '0.2.0',
  scheme: 'alarmat',
  // A subdirectory is only used by the VPS web export, never native deep links.
  experiments: { baseUrl: process.env.ALARMAT_WEB_BASE_PATH || undefined },
  web: { output: 'single', favicon: './assets/brand/favicon.png' },
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/brand/icon.png',
  android: {
    package: 'com.closedai.alarmat',
    versionCode: 2,
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
    ['expo-image-picker', { cameraPermission: 'AlarmaT necesita la cámara para fotografiar tus tickets.', microphonePermission: false }],
    'expo-document-picker',
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
            displayName: 'AlarmaT · Tablón',
            description: 'Tu tablón del piso: próxima alarma y notas de tareas. Desliza para ver más.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
            android: {
              targetCellWidth: 4,
              targetCellHeight: 3,
              resizeMode: 'both',
              initialLayout: './src/widgets/AlarmaTWidget.tsx',
            },
          },
          {
            name: 'AlarmaTAlarmsWidget',
            displayName: 'AlarmaT · Alarmas',
            description: 'Próxima alarma, hora y propuestas pendientes con los colores de AlarmaT.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
            android: { targetCellWidth: 4, targetCellHeight: 3, resizeMode: 'both', initialLayout: './src/widgets/AlarmaTAlarmsWidget.tsx' },
          },
          {
            name: 'AlarmaTTasksWidget',
            displayName: 'AlarmaT · Tareas',
            description: 'Tareas pendientes con nombre, fecha y persona asignada. Desliza para ver más.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
            android: { targetCellWidth: 4, targetCellHeight: 3, resizeMode: 'both', initialLayout: './src/widgets/AlarmaTTasksWidget.tsx' },
          },
        ],
      },
    ],
    './plugins/with-widget-links.cjs',
    './plugins/with-release-signing.cjs',
  ],
};

export default config;
