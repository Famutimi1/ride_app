import { Platform } from 'react-native';

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

let modulePromise: Promise<GoogleSignInModule> | null = null;
let configured = false;

async function loadGoogleSignIn(): Promise<GoogleSignInModule> {
  try {
    modulePromise ??= import('@react-native-google-signin/google-signin');
    return await modulePromise;
  } catch {
    modulePromise = null;
    throw new Error(
      'Google sign-in requires a Rakky Ride development build. Expo Go does not include the native Google Sign-In module.',
    );
  }
}

export async function getGoogleIdToken(): Promise<string> {
  if (!webClientId) {
    throw new Error('Google sign-in is not configured. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to mobile/.env.');
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    throw new Error('Google sign-in is not configured for iOS. Add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to mobile/.env.');
  }

  const { GoogleSignin } = await loadGoogleSignIn();
  if (!configured) {
    GoogleSignin.configure({ iosClientId, webClientId });
    configured = true;
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (result.type !== 'success' || !result.data.idToken) {
    throw new Error('Google sign-in was cancelled.');
  }
  return result.data.idToken;
}
