import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Input, Text } from '@/components/common';
import { GoogleAuthButton } from '@/components/common/GoogleAuthButton';
import { useAuthStore, type RegistrationAccountType } from '@/store/authStore';

import { AuthScreenLayout } from './AuthScreenLayout';

function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function PhoneScreen() {
  const router = useRouter();
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithGoogleIdToken = useAuthStore((state) => state.signInWithGoogleIdToken);
  const googlePendingName = useAuthStore((state) => state.pending?.phoneVerificationToken ? state.pending.name : undefined);
  const [fullName, setFullName] = useState(googlePendingName ?? '');
  const [localNumber, setLocalNumber] = useState('');
  const [accountType, setAccountType] = useState<RegistrationAccountType>('rider');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const valid = fullName.trim().length >= 2 && localNumber.length === 10;
  const continueRegistration = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      await requestOtp(`+234${localNumber}`, {
        name: fullName.trim(),
        intent: 'register',
        accountType,
      });
      router.push('/otp');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const continueWithGoogle = async (idToken?: string) => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    setError(undefined);
    try {
      const destination = idToken ? await signInWithGoogleIdToken(idToken) : await signInWithGoogle();
      if (destination === 'phone') {
        const googleName = useAuthStore.getState().pending?.name;
        if (googleName) setFullName(googleName);
      } else {
        router.replace(destination === 'driver-dashboard' ? '/driver-dashboard' : destination === 'driver-status' ? '/driver-status' : '/home');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google sign-up failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <AuthScreenLayout
      title="Create your account"
      subtitle={googlePendingName ? 'Google sign-in is connected. Verify your phone number to finish setting up your account.' : 'Choose how you want to use Rakky Ride. You can add driver access later.'}
      onBack={() => router.canGoBack() ? router.back() : router.replace('/welcome')}
      scrollEnabled={false}
      footerPinned={false}
      footer={(
        <View className="gap-md">
          <Button label="Continue" fullWidth loading={loading} disabled={!valid || googleLoading} onPress={continueRegistration} />

          {!googlePendingName ? (
            <>
              <View className="flex-row items-center gap-md">
                <View className="h-px flex-1 bg-border" />
                <Text variant="caption" color="textMuted">or</Text>
                <View className="h-px flex-1 bg-border" />
              </View>

              <GoogleAuthButton
                mode="signup"
                loading={googleLoading}
                disabled={loading}
                onPress={() => void continueWithGoogle()}
                onCredential={(token) => void continueWithGoogle(token)}
                onError={(reason) => setError(reason.message)}
              />
            </>
          ) : null}

          <View className="flex-row justify-center gap-xs">
            <Text variant="caption" color="textMuted">Already have an account?</Text>
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.replace('/login')}>
              <Text variant="caption" color="primary">Log in</Text>
            </Pressable>
          </View>
        </View>
      )}
    >
      <View className="gap-md">
        <Input
          label="Full name"
          placeholder="Enter your full name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          maxLength={80}
        />

        <View className="gap-[6px]">
          <Text variant="caption" color="textMuted" className="ml-[2px]">Phone number</Text>
          <View className="flex-row gap-sm">
            <View className="h-[52px] flex-row items-center gap-xs rounded-md border border-borderStrong bg-surfaceMuted px-md">
              <Text>🇳🇬</Text><Text variant="bodyMedium">+234</Text>
            </View>
            <View className="flex-1">
              <Input
                accessibilityLabel="Phone number"
                placeholder="801 234 5678"
                value={localNumber}
                onChangeText={(value) => { setLocalNumber(normalizeLocalNumber(value)); setError(undefined); }}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                maxLength={10}
                error={error}
              />
            </View>
          </View>
        </View>

        <View className="gap-[6px]">
          <Text variant="caption" color="textMuted" className="ml-[2px]">Account type</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select account type"
            accessibilityState={{ expanded: accountMenuOpen }}
            onPress={() => setAccountMenuOpen((open) => !open)}
            className="h-[52px] flex-row items-center rounded-md border border-borderStrong bg-surfaceMuted px-lg active:opacity-70"
          >
            <View className="h-8 w-8 items-center justify-center rounded-full bg-primarySoft"><Text color="primary">{accountType === 'rider' ? '◎' : '🚘'}</Text></View>
            <Text variant="bodyMedium" className="ml-md flex-1">{accountType === 'rider' ? 'Rider' : 'Driver'}</Text>
            <Text color="icon">⌄</Text>
          </Pressable>
          {accountMenuOpen ? (
            <View className="overflow-hidden rounded-md border border-border bg-surface shadow-md">
              <AccountOption label="Rider" detail="Book rides and manage trips" selected={accountType === 'rider'} onPress={() => { setAccountType('rider'); setAccountMenuOpen(false); }} />
              <AccountOption label="Driver" detail="Apply to drive after phone verification" selected={accountType === 'driver'} onPress={() => { setAccountType('driver'); setAccountMenuOpen(false); }} />
            </View>
          ) : null}
        </View>

        <View className="rounded-xl bg-primarySoft p-md">
          <Text variant="caption" color="primary">We&apos;ll text a six-digit code to verify your phone number.</Text>
        </View>
      </View>
    </AuthScreenLayout>
  );
}

function AccountOption({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} className={`flex-row items-center border-b border-border px-lg py-md active:opacity-70 ${selected ? 'bg-primarySoft' : 'bg-surface'}`}>
      <View className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-primary' : 'border-borderStrong'}`}>{selected ? <View className="h-3 w-3 rounded-full bg-primary" /> : null}</View>
      <View className="ml-md flex-1"><Text variant="bodyMedium">{label}</Text><Text variant="caption" color="textMuted">{detail}</Text></View>
    </Pressable>
  );
}
