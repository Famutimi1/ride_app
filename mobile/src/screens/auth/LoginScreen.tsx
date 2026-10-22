/** Phone-based sign-in for returning Rakky Ride users (route: "/login"). */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, BrandLogo, Button, Input, Text } from '@/components/common';
import { GoogleAuthButton } from '@/components/common/GoogleAuthButton';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const illustrationHeight = Math.max(120, Math.min(190, height * 0.23));
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithGoogleIdToken = useAuthStore((state) => state.signInWithGoogleIdToken);
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const isValid = localNumber.length === 10;

  const onChangeNumber = (value: string) => {
    setLocalNumber(normalizeLocalNumber(value));
    if (error) setError(undefined);
  };

  const onLogin = async () => {
    if (!isValid || phoneLoading || googleLoading) return;
    setPhoneLoading(true);
    setError(undefined);
    try {
      await requestOtp(`+234${localNumber}`, { intent: 'login' });
      router.push('/otp');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the code. Try again.');
    } finally {
      setPhoneLoading(false);
    }
  };
  const onGoogle = async (idToken?: string) => {
    if (googleLoading || phoneLoading) return;
    setGoogleLoading(true);
    setError(undefined);
    try {
      const destination = idToken
        ? await signInWithGoogleIdToken(idToken)
        : await signInWithGoogle();
      router.replace(destination === 'phone' ? '/phone'
        : destination === 'driver-dashboard' ? '/driver-dashboard'
          : destination === 'driver-status' ? '/driver-status' : '/home');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const glow = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220"><defs><radialGradient id="halo"><stop stop-color="${colors.primarySoft}"/><stop offset="1" stop-color="${colors.background}" stop-opacity="0"/></radialGradient></defs><ellipse cx="180" cy="110" rx="180" ry="110" fill="url(#halo)"/></svg>`,
  )}`;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <BackButton onPress={() => router.canGoBack() ? router.back() : router.replace('/welcome')} />
              <View style={styles.brand}>
                <BrandLogo size={32} />
                <Text variant="bodyMedium">Rakky Ride</Text>
              </View>
            </View>

            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.artwork, { height: illustrationHeight }]}>
              <Image source={{ uri: glow }} contentFit="fill" style={StyleSheet.absoluteFill} />
              <Image source={require('@/assets/images/onboarding-v3/ride.png')} contentFit="contain" style={styles.car} />
            </View>

            <View style={styles.heading}>
              <Text variant="h1" accessibilityRole="header">Welcome back.</Text>
              <Text variant="body" color="textMuted">Your next ride starts here.</Text>
            </View>

            <View style={styles.form}>
              <Input
                accessibilityLabel="Phone number"
                placeholder="Phone number"
                value={localNumber}
                onChangeText={onChangeNumber}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="done"
                onSubmitEditing={() => void onLogin()}
                editable={!phoneLoading && !googleLoading}
                maxLength={10}
                error={error}
                containerClassName="!min-h-[56px] !rounded-2xl"
                leftIcon={(
                  <View style={[styles.countryCode, { borderRightColor: colors.border }]}>
                    <Text>🇳🇬</Text>
                    <Text variant="bodyMedium">+234</Text>
                  </View>
                )}
              />
              <Text variant="caption" color="textMuted">We’ll text you a login code.</Text>
            </View>

            <View style={styles.actions}>
              <Button
                label="Continue"
                size="lg"
                className="!rounded-full"
                fullWidth
                loading={phoneLoading}
                disabled={!isValid || googleLoading}
                rightIcon={<Text variant="button" color="textInverse">→</Text>}
                onPress={onLogin}
              />

              <View className="flex-row items-center gap-md">
                <View className="h-px flex-1 bg-border" />
                <Text variant="caption" color="textMuted">or</Text>
                <View className="h-px flex-1 bg-border" />
              </View>

              <GoogleAuthButton
                mode="signin"
                loading={googleLoading}
                disabled={phoneLoading}
                onPress={() => void onGoogle()}
                onCredential={(token) => void onGoogle(token)}
                onError={(reason) => setError(reason.message)}
              />
            </View>

            <View style={styles.signup}>
              <Text variant="caption" color="textMuted">New to Rakky Ride?</Text>
              <Pressable
                accessibilityRole="link"
                style={styles.signupLink}
                onPress={() => router.replace('/phone')}
              >
                <Text variant="button" color="primary">Sign up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 460, paddingHorizontal: 24, paddingBottom: 24 },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  artwork: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  car: { width: '100%', maxWidth: 260, height: '100%' },
  heading: { gap: 8, marginTop: 12 },
  form: { gap: 10, marginTop: 28 },
  countryCode: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12, marginRight: 4, borderRightWidth: 1 },
  actions: { gap: 20, marginTop: 24 },
  signup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 20 },
  signupLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
