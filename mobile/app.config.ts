import type { ConfigContext, ExpoConfig } from 'expo/config';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import withAndroidNdkVersion from './plugins/withAndroidNdkVersion.ts';
import withNativeCalls from './plugins/withNativeCalls.ts';
import withVariantNetwork from './plugins/withVariantNetwork.ts';
import { nativeBrandColors } from './src/constants/colors.ts';
import { appVariant, validateFirebaseClient, validateVariantApi } from './config/appVariants.ts';

/** Inject the .env Google Maps key into native map configuration at build time. */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  // Config may load as CommonJS locally or as a native ES module on EAS.
  // Expo supplies the project root in both cases, even from a different cwd.
  try {
    loadEnvFile(resolve(projectRoot, '.env'));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }

  // Local builds use the ignored file in the mobile root. EAS file environment
  // variables resolve to a temporary path and can override it in cloud builds.
  const variant = appVariant(process.env.APP_VARIANT);
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? variant.googleServicesFile;
  validateVariantApi(variant.variant, process.env.EXPO_PUBLIC_API_BASE_URL);
  const firebasePath = resolve(projectRoot, googleServicesFile);
  if (existsSync(firebasePath)) {
    let client: unknown;
    try { client = JSON.parse(readFileSync(firebasePath, 'utf8')); }
    catch { throw new Error('The Firebase client configuration must be readable JSON.'); }
    validateFirebaseClient(client, variant.applicationId);
  }
  const sharedGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY?.trim();
  const androidGoogleMapsKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim() || sharedGoogleMapsKey;
  const iosGoogleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?.trim() || sharedGoogleMapsKey;
  const iosGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  if (!androidGoogleMapsKey || !iosGoogleMapsKey) {
    throw new Error(
      'Google Maps is not configured. Set EXPO_PUBLIC_GOOGLE_MAPS_KEY (or both platform keys) in the EAS environment selected by eas.json. Local development can use mobile/.env.',
    );
  }

  const configuredPlugins = [...(config.plugins ?? [])].filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-dev-client');
  configuredPlugins.push(['expo-dev-client', { addGeneratedScheme: variant.developmentClient }]);
  const plugins: ExpoConfig['plugins'] = configuredPlugins.map((plugin) => {
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
    if (plugin === 'expo-notifications') {
      return [
        'expo-notifications',
        {
          color: nativeBrandColors.primary,
          defaultChannel: 'trip_updates',
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

  // Calling is a normal app feature; retain the old opt-out for existing builds.
  const nativeCallsSetting=process.env.RAKKY_NATIVE_CALLS_ENABLED??'true';
  if(!['true','false'].includes(nativeCallsSetting))throw new Error('RAKKY_NATIVE_CALLS_ENABLED must be true or false.');
  const nativeCallsEnabled=nativeCallsSetting==='true';
  const apnsEnvironment=process.env.RAKKY_APNS_ENVIRONMENT??'development';
  if(!['development','production'].includes(apnsEnvironment))throw new Error('RAKKY_APNS_ENVIRONMENT must be development or production.');
  return withAndroidNdkVersion(withVariantNetwork(withNativeCalls({
    ...config,
    name: variant.name,
    scheme: variant.scheme,
    extra: { ...config.extra, appVariant: variant.variant },
    primaryColor: nativeBrandColors.primary,
    ios: {
      ...config.ios,
      bundleIdentifier: variant.applicationId,
      infoPlist: {...config.ios?.infoPlist,NSMicrophoneUsageDescription:'Allow Rakky Ride to use your microphone for trip calls.',NSCameraUsageDescription:'Allow Rakky Ride to use your camera when you choose a trip video call.'},
    },
    android: {
      ...config.android,
      package: variant.applicationId,
      permissions: [...new Set([...(config.android?.permissions??[]),'android.permission.CAMERA','android.permission.RECORD_AUDIO','android.permission.MODIFY_AUDIO_SETTINGS','android.permission.ACCESS_NETWORK_STATE','android.permission.WAKE_LOCK'])],
      googleServicesFile,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        backgroundColor: nativeBrandColors.iconBackground,
      },
    },
    plugins,
  } as ExpoConfig,{enabled:nativeCallsEnabled,apnsEnvironment:apnsEnvironment as 'development'|'production'}), { testApp: !variant.production }));
};
