import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { renderGoogleButton } from '@/services/googleSignIn';

import { Button } from './Button';

interface GoogleAuthButtonProps {
  mode: 'signin' | 'signup';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onCredential: (token: string) => void;
  onError: (error: Error) => void;
}

export function GoogleAuthButton({ mode, loading, disabled, onCredential, onError }: GoogleAuthButtonProps) {
  const { width } = useWindowDimensions();
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    callbacks.current = { onCredential, onError };
  }, [onCredential, onError]);

  // GIS fixes its iframe width when rendered; refresh it after a window resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading || disabled) return;
    let disposed = false;
    void renderGoogleButton(container, mode, (token) => {
      if (!disposed) callbacks.current.onCredential(token);
    }).catch((reason: unknown) => {
      if (disposed) return;
      setFailed(true);
      callbacks.current.onError(reason instanceof Error ? reason : new Error('Google sign-in could not be loaded.'));
    });
    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [attempt, disabled, loading, mode, width]);

  if (loading || disabled || failed) {
    return (
      <Button
        label={failed ? 'Retry Google sign-in' : mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
        variant="outline"
        fullWidth
        loading={loading}
        disabled={disabled}
        onPress={() => { setFailed(false); setAttempt((value) => value + 1); }}
      />
    );
  }

  return <div ref={containerRef} style={{ alignItems: 'center', display: 'flex', minHeight: 48, justifyContent: 'center', width: '100%' }} />;
}
