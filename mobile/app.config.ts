import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

declare const __dirname: string;
declare const require: (id: string) => unknown;

const { resolve } = require('path') as { resolve: (...paths: string[]) => string };
const { loadEnvFile } = require('process') as { loadEnvFile: (path: string) => void };

// Dynamic app config is evaluated before Expo's usual client-env loading step.
// Load the project-local file explicitly using Node's built-in environment loader.
loadEnvFile(resolve(__dirname, '.env'));

/** Inject the .env Google Maps key into native map configuration at build time. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const sharedGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const androidGoogleMapsKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? sharedGoogleMapsKey;
  const iosGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? sharedGoogleMapsKey;

  if (!androidGoogleMapsKey || !iosGoogleMapsKey) {
    throw new Error(
      'Google Maps is not configured. Add EXPO_PUBLIC_GOOGLE_MAPS_KEY to mobile/.env.',
    );
  }

  const baseConfig = appJson.expo;
  const plugins: ExpoConfig['plugins'] = baseConfig.plugins.map((plugin) => {
    if (plugin === 'react-native-maps') {
      return [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: androidGoogleMapsKey,
          iosGoogleMapsApiKey: iosGoogleMapsKey,
        },
      ];
    }
    return plugin as NonNullable<ExpoConfig['plugins']>[number];
  });

  return {
    ...config,
    ...baseConfig,
    android: baseConfig.android,
    ios: baseConfig.ios,
    plugins,
  } as ExpoConfig;
};
