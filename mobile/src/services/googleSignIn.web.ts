const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

interface CredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        ux_mode?: 'popup';
        use_fedcm_for_button?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type: 'standard';
          theme: 'outline';
          size: 'large';
          text: 'signin_with' | 'signup_with';
          shape: 'rectangular';
          width: number;
        },
      ): void;
    };
  };
}

export async function renderGoogleButton(
  parent: HTMLElement,
  mode: 'signin' | 'signup',
  onCredential: (token: string) => void,
): Promise<void> {
  if (!googleWebClientId) {
    throw new Error('Google sign-in is not configured. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to mobile/.env.');
  }
  const google = await loadGoogleIdentity();
  if (!parent.isConnected) return;
  google.accounts.id.initialize({
    client_id: googleWebClientId,
    auto_select: false,
    ux_mode: 'popup',
    use_fedcm_for_button: false,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
    },
  });
  parent.replaceChildren();
  google.accounts.id.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: mode === 'signup' ? 'signup_with' : 'signin_with',
    shape: 'rectangular',
    width: Math.min(parent.clientWidth, 400),
  });
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

let scriptPromise: Promise<GoogleIdentityApi> | undefined;
function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in could not be loaded.'));
    const onError = () => {
      script.remove();
      reject(new Error('Google sign-in could not be loaded. Check your connection and try again.'));
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((reason: unknown) => {
    scriptPromise = undefined;
    throw reason;
  });

  return scriptPromise;
}

// Web sign-in must start from Google's rendered button. One Tap's prompt() is
// optional browser-mediated UI and is not a replacement for a sign-in button.
export async function getGoogleIdToken(): Promise<string> {
  throw new Error('Use the Google sign-in button to continue in your browser.');
}
