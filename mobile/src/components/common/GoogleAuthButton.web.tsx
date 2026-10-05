import { useEffect, useRef } from 'react';

import { Button } from './Button';
import { renderGoogleButton } from '@/services/googleSignIn';

interface GoogleAuthButtonProps {
  mode: 'signin' | 'signup';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onCredential: (token: string) => void;
  onError: (error: Error) => void;
}

export function GoogleAuthButton({ mode, loading, disabled, onCredential, onError }: GoogleAuthButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading || disabled) return;
    void renderGoogleButton(container, mode, onCredential).catch((reason: unknown) => {
      onError(reason instanceof Error ? reason : new Error('Google sign-in could not be loaded.'));
    });
  }, [disabled, loading, mode, onCredential, onError]);

  if (loading || disabled) {
    return <Button label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'} variant="outline" fullWidth loading={loading} disabled />;
  }

  return <div ref={containerRef} style={{ alignItems: 'center', display: 'flex', height: 52, justifyContent: 'center', width: '100%' }} />;
}
