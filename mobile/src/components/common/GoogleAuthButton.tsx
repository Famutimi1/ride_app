import { Button } from './Button';
import { Text } from './Text';

interface GoogleAuthButtonProps {
  mode: 'signin' | 'signup';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onCredential: (token: string) => void;
  onError: (error: Error) => void;
}

export function GoogleAuthButton({ mode, loading, disabled, onPress }: GoogleAuthButtonProps) {
  return (
    <Button
      label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
      variant="outline"
      fullWidth
      loading={loading}
      disabled={disabled}
      leftIcon={<Text variant="button">G</Text>}
      onPress={onPress}
    />
  );
}
