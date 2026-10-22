import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'alarmaT',
  slug: 'alarmat',
  version: '0.1.0',
  scheme: 'alarmat',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  android: { package: 'com.closedai.alarmat' },
  plugins: ['expo-router'],
};

export default config;
