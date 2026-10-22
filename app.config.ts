import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'alarmaT',
  slug: 'alarmat',
  version: '0.1.0',
  scheme: 'alarmat',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  android: { package: 'com.closedai.alarmat' },
  plugins: [
    'expo-router',
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
              targetCellHeight: 2,
              resizeMode: 'horizontal',
              initialLayout: './src/widgets/AlarmaTWidget.tsx',
            },
          },
        ],
      },
    ],
  ],
};

export default config;
