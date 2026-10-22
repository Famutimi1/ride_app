import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, BrandLogo, Button, Input, Text } from '@/components/common';
import { GoogleAuthButton } from '@/components/common/GoogleAuthButton';
import { useTheme } from '@/constants/theme';
import { useAuthStore, type RegistrationAccountType } from '@/store/authStore';

function normalizeLocalNumber(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
}

export function PhoneScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithGoogleIdToken = useAuthStore((state) => state.signInWithGoogleIdToken);
  const googlePendingName = useAuthStore((state) => state.pending?.phoneVerificationToken ? state.pending.name : undefined);
  const [fullName, setFullName] = useState(googlePendingName ?? '');
  const [email, setEmail] = useState('');
  const [localNumber, setLocalNumber] = useState('');
  const [accountType, setAccountType] = useState<RegistrationAccountType>('rider');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const emailValid = !email.trim() || (email.trim().length <= 160 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim()));
  const valid = fullName.trim().length >= 2 && localNumber.length === 10 && (Boolean(googlePendingName) || emailValid);
  const continueRegistration = async () => {
    if (!valid || loading || googleLoading) return;
    setLoading(true);
    setError(undefined);
    try {
      await requestOtp(`+234${localNumber}`, {
        name: fullName.trim(),
        email: googlePendingName ? undefined : email.trim().toLowerCase() || undefined,
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

  const busy = loading || googleLoading;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <View style={styles.header}>
              <BackButton onPress={() => router.canGoBack() ? router.back() : router.replace('/welcome')} />
              <View style={styles.brand}>
                <BrandLogo size={32} />
                <Text variant="bodyMedium">Rakky Ride</Text>
              </View>
            </View>

            <View style={styles.intro}>
              <View style={styles.introCopy}>
                <Text variant="h2" accessibilityRole="header">{googlePendingName ? 'One last step.' : 'Join Rakky Ride.'}</Text>
                <Text variant="body" color="textMuted">
                  {googlePendingName ? 'Verify your phone to finish signing up.' : 'A few details. Then you’re ready.'}
                </Text>
              </View>
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
                <Image source={require('@/assets/images/register-v1/car.png')} contentFit="contain" style={styles.car} />
              </View>
            </View>

            <View style={styles.form}>
              <Input
                label="Full name"
                placeholder="Your full name"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                maxLength={80}
                editable={!busy}
                containerClassName="!rounded-2xl"
              />

              {!googlePendingName ? (
                <Input
                  label="Email (optional)"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  maxLength={160}
                  editable={!busy}
                  containerClassName="!rounded-2xl"
                  error={!emailValid ? 'Enter a valid email address, or leave it empty.' : undefined}
                />
              ) : (
                <View style={[styles.googleConnected, { backgroundColor: colors.primarySoft }]}>
                  <Text variant="caption" color="primary">✓ Google account connected</Text>
                </View>
              )}

              <Input
                label="Phone number"
                placeholder="801 234 5678"
                value={localNumber}
                onChangeText={(value) => { setLocalNumber(normalizeLocalNumber(value)); setError(undefined); }}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="done"
                onSubmitEditing={() => void continueRegistration()}
                maxLength={10}
                editable={!busy}
                containerClassName="!rounded-2xl"
                leftIcon={(
                  <View style={[styles.countryCode, { borderRightColor: colors.border }]}>
                    <Text>🇳🇬</Text>
                    <Text variant="bodyMedium">+234</Text>
                  </View>
                )}
              />

              <View style={styles.accountType}>
                <Text variant="caption" color="textMuted">I want to join as a</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Account type" style={styles.accountOptions}>
                  <AccountOption label="Rider" selected={accountType === 'rider'} disabled={busy} onPress={() => setAccountType('rider')} />
                  <AccountOption label="Driver" selected={accountType === 'driver'} disabled={busy} onPress={() => setAccountType('driver')} />
                </View>
                <Text variant="caption" color="textMuted">
                  {accountType === 'rider' ? 'You can add driving later.' : 'Driver setup follows phone verification.'}
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              {error ? <Text variant="caption" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
              <Button
                label="Continue"
                size="lg"
                className="!rounded-full"
                fullWidth
                loading={loading}
                disabled={!valid || googleLoading}
                rightIcon={<Text variant="button" color="textInverse">→</Text>}
                onPress={continueRegistration}
              />
              <Text variant="caption" color="textMuted" style={styles.centerText}>We’ll text you a verification code.</Text>

              {!googlePendingName ? (
                <>
                  <View style={styles.divider}>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                    <Text variant="caption" color="textMuted">or</Text>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
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
            </View>

            <View style={styles.login}>
              <Text variant="caption" color="textMuted">Already a member?</Text>
              <Pressable accessibilityRole="link" style={styles.loginLink} onPress={() => router.replace('/login')}>
                <Text variant="button" color="primary">Log in</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AccountOption({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.accountOption, {
        backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted,
        borderColor: selected ? colors.primary : colors.borderStrong,
        opacity: pressed || disabled ? 0.6 : 1,
      }]}
    >
      <Text variant="bodyMedium" color={selected ? 'primary' : 'text'}>{label}</Text>
      <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primary : colors.background }]}>
        {selected ? <Text variant="caption" color="textInverse">✓</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 460, paddingHorizontal: 24, paddingBottom: 16 },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 24 },
  introCopy: { flex: 1, gap: 8 },
  car: { width: 88, height: 88 },
  form: { gap: 14 },
  countryCode: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12, marginRight: 4, borderRightWidth: 1 },
  accountType: { gap: 8 },
  accountOptions: { flexDirection: 'row', gap: 12 },
  accountOption: { flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  googleConnected: { borderRadius: 12, padding: 12 },
  actions: { gap: 14, marginTop: 22 },
  centerText: { textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dividerLine: { height: 1, flex: 1 },
  login: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 },
  loginLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
