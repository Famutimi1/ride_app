export async function getGoogleIdToken():Promise<string>{throw new Error('Google sign-in requires the Rakky Ride development build on iOS or Android.');}
export async function renderGoogleButton(
  _parent: HTMLElement,
  _mode: 'signin' | 'signup',
  _onCredential: (token: string) => void,
): Promise<void> {
  throw new Error('The Google web button is only available in a browser.');
}
