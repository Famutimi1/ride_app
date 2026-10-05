/** Phone-based sign-in for returning Rakky Ride users (route: "/login"). */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Input, Text } from '@/components/common';
import { GoogleAuthButton } from '@/components/common/GoogleAuthButton';
import { useAuthStore } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function LoginScreen() {
  const router = useRouter();
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithGoogleIdToken = useAuthStore((state) => state.signInWithGoogleIdToken);
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const isValid = localNumber.length === 10;

  const onChangeNumber = (value: string) => {
    setLocalNumber(normalizeLocalNumber(value));
    if (error) setError(undefined);
  };

  const onLogin = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      await requestOtp(`+234${localNumber}`, { intent: 'login' });
      router.push('/otp');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the code. Try again.');
    } finally {
      setLoading(false);
    }
  };
  const onGoogle = async (idToken?: string) => {
    setLoading(true); setError(undefined);
    try { const destination=idToken?await signInWithGoogleIdToken(idToken):await signInWithGoogle(); router.replace(destination==='phone'?'/phone':destination==='driver-dashboard'?'/driver-dashboard':destination==='driver-status'?'/driver-status':'/home'); }
    catch(reason){setError(reason instanceof Error?reason.message:'Google sign-in failed.');}
    finally{setLoading(false);}
  };

  return (
    <AuthScreenLayout
      title="Welcome back"
      subtitle="Enter the phone number linked to your Rakky Ride account."
      onBack={() => router.canGoBack() ? router.back() : router.replace('/welcome')}
      footer={(
        <View className="gap-lg">
          <Button
            label="Continue"
            fullWidth
            loading={loading}
            disabled={!isValid}
            onPress={onLogin}
          />

          <View className="flex-row items-center gap-md">
            <View className="h-px flex-1 bg-border" />
            <Text variant="caption" color="textMuted">or</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <GoogleAuthButton
            mode="signin"
            loading={loading}
            disabled={false}
            onPress={() => void onGoogle()}
            onCredential={(token) => void onGoogle(token)}
            onError={(reason) => setError(reason.message)}
          />

          <View className="flex-row justify-center gap-xs">
            <Text variant="caption" color="textMuted">Don&apos;t have an account?</Text>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => router.replace('/phone')}
            >
              <Text variant="caption" color="primary">Sign up</Text>
            </Pressable>
          </View>
        </View>
      )}
    >
      <View className="mt-md gap-sm">
        <Text variant="caption" color="text">Phone number</Text>
        <View className="flex-row gap-sm">
          <View className="h-[52px] flex-row items-center gap-xs rounded-md border border-borderStrong bg-surfaceMuted px-md">
            <Text>🇳🇬</Text>
            <Text variant="bodyMedium">+234</Text>
          </View>
          <View className="flex-1">
            <Input
              accessibilityLabel="Phone number"
              placeholder="Enter phone number"
              value={localNumber}
              onChangeText={onChangeNumber}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={10}
              error={error}
            />
          </View>
        </View>
        <Text variant="caption" color="textMuted">
          We&apos;ll send a one-time code to verify it&apos;s you.
        </Text>
      </View>
    </AuthScreenLayout>
  );
}
