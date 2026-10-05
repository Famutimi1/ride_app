const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

interface CredentialResponse {
  credential?: string;
}

interface PromptMomentNotification {
  isNotDisplayed(): boolean;
  getNotDisplayedReason(): string;
  isSkippedMoment(): boolean;
  getSkippedReason(): string;
  isDismissedMoment(): boolean;
  getDismissedReason(): string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        context?: 'signin' | 'signup' | 'use';
        use_fedcm_for_prompt?: boolean;
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
      prompt(callback?: (notification: PromptMomentNotification) => void): void;
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
  google.accounts.id.initialize({
    client_id: googleWebClientId,
    auto_select: false,
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
let pendingRequest: {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
} | undefined;

function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (window.google) return Promise.resolve(window.google);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => window.google ? resolve(window.google) : reject(new Error('Google sign-in could not be loaded.'));
    const onError = () => reject(new Error('Google sign-in could not be loaded. Check your connection and try again.'));

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

function settlePending(error?: Error, token?: string) {
  const request = pendingRequest;
  if (!request) return;
  clearTimeout(request.timeout);
  pendingRequest = undefined;
  if (token) request.resolve(token);
  else request.reject(error ?? new Error('Google sign-in was cancelled.'));
}

export async function getGoogleIdToken(): Promise<string> {
  if (!googleWebClientId) {
    throw new Error('Google sign-in is not configured. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to mobile/.env.');
  }
  if (pendingRequest) throw new Error('Google sign-in is already open.');

  const google = await loadGoogleIdentity();
  google.accounts.id.initialize({
    client_id: googleWebClientId,
    auto_select: false,
    cancel_on_tap_outside: false,
    context: 'signin',
    use_fedcm_for_prompt: false,
    callback: (response) => {
      if (response.credential) settlePending(undefined, response.credential);
      else settlePending(new Error('Google did not return an identity token.'));
    },
  });

  return new Promise<string>((resolve, reject) => {
    pendingRequest = {
      resolve,
      reject,
      timeout: setTimeout(() => settlePending(new Error('Google sign-in timed out. Please try again.')), 90_000),
    };

    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        settlePending(new Error(`Google sign-in could not open (${notification.getNotDisplayedReason()}).`));
      } else if (notification.isSkippedMoment()) {
        settlePending(new Error(`Google sign-in was skipped (${notification.getSkippedReason()}).`));
      } else if (notification.isDismissedMoment() && notification.getDismissedReason() !== 'credential_returned') {
        settlePending(new Error('Google sign-in was cancelled.'));
      }
    });
  });
}
