import type { ConfigContext, ExpoConfig } from 'expo/config';

declare const __dirname: string;
declare const require: (id: string) => unknown;

// The build runs on Node 24, whose native TypeScript loader needs the extension.
const { nativeBrandColors } = require('./src/constants/colors.ts') as typeof import('./src/constants/colors');

const { resolve } = require('path') as { resolve: (...paths: string[]) => string };
const { loadEnvFile } = require('process') as { loadEnvFile: (path: string) => void };

// Dynamic app config is evaluated before Expo's usual client-env loading step.
// Load the project-local file when present; EAS supplies cloud variables directly.
try {
  loadEnvFile(resolve(__dirname, '.env'));
} catch (error) {
  if ((error as { code?: string }).code !== 'ENOENT') throw error;
}

/** Inject the .env Google Maps key into native map configuration at build time. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const sharedGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const androidGoogleMapsKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? sharedGoogleMapsKey;
  const iosGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? sharedGoogleMapsKey;
  const iosGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  if (!androidGoogleMapsKey || !iosGoogleMapsKey) {
    throw new Error(
      'Google Maps is not configured. Add EXPO_PUBLIC_GOOGLE_MAPS_KEY to mobile/.env.',
    );
  }

  const plugins: ExpoConfig['plugins'] = (config.plugins ?? []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
      return ['expo-splash-screen', {
        image: './assets/images/brand/rakky-ride-logo.png',
        imageWidth: 288,
        resizeMode: 'contain',
        backgroundColor: nativeBrandColors.lightBackground,
        dark: { backgroundColor: nativeBrandColors.darkBackground },
      }];
    }
    if (plugin === 'react-native-maps') {
      return [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: androidGoogleMapsKey,
          iosGoogleMapsApiKey: iosGoogleMapsKey,
        },
      ];
    }
    if (plugin === '@react-native-google-signin/google-signin' && iosGoogleClientId) {
      const reversedClientId = iosGoogleClientId.replace(
        /^(.*)\.apps\.googleusercontent\.com$/,
        'com.googleusercontent.apps.$1',
      );
      return [plugin, { iosUrlScheme: reversedClientId }];
    }
    return plugin as NonNullable<ExpoConfig['plugins']>[number];
  });

  return {
    ...config,
    primaryColor: nativeBrandColors.primary,
    android: {
      ...config.android,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        backgroundColor: nativeBrandColors.iconBackground,
      },
    },
    plugins,
  } as ExpoConfig;
};
