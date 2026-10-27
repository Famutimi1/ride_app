import { UserFacingError } from '@/utils/userMessage';
export async function getGoogleIdToken():Promise<string>{throw new UserFacingError('Google sign-in requires the Rakky Ride development build on iOS or Android.');}
export async function renderGoogleButton(
  _parent: HTMLElement,
  _mode: 'signin' | 'signup',
  _onCredential: (token: string) => void,
): Promise<void> {
  throw new UserFacingError('The Google web button is only available in a browser.');
}
