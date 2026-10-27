import { UserFacingError } from '@/utils/userMessage';
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
    throw new UserFacingError(
      'Google sign-in is unavailable in this version of the app. Try signing in with your phone number.',
    );
  }
}

export async function getGoogleIdToken(): Promise<string> {
  if (!webClientId) {
    throw new UserFacingError('Google sign-in is temporarily unavailable. Try signing in with your phone number.');
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    throw new UserFacingError('Google sign-in is temporarily unavailable. Try signing in with your phone number.');
  }

  const { GoogleSignin } = await loadGoogleSignIn();
  if (!configured) {
    GoogleSignin.configure({ iosClientId, webClientId });
    configured = true;
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (result.type !== 'success' || !result.data.idToken) {
    throw new UserFacingError('Google sign-in was cancelled.');
  }
  return result.data.idToken;
}
