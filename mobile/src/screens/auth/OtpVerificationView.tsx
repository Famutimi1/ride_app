import { AppMessage } from '@/components/common/AppMessage';
import { useState, type RefObject } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLogo, Button, Text } from '@/components/common';
import { AddressIcon } from '@/components/map/AddressIcon';
import { useTheme } from '@/constants/theme';

interface OtpVerificationViewProps {
  phone: string; code: string; inputRef: RefObject<TextInput | null>; error?: string;
  loading: boolean; resending: boolean; seconds: number;
  onBack: () => void; onChangeNumber: () => void; onCodeChange: (value: string) => void;
  onVerify: () => void; onResend: () => void;
}

/** Matches the saved verification proposal; requests remain in OtpScreen. */
export function OtpVerificationView({ phone, code, inputRef, error, loading, resending, seconds, onBack, onChangeNumber, onCodeChange, onVerify, onResend }: OtpVerificationViewProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const busy = loading || resending;
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.frame}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Go back" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
            <View style={styles.brand}><BrandLogo size={36} /><Text variant="button">RAKKY <Text variant="button" color="primary">RIDE</Text></Text></View>
            <View pointerEvents="none" style={styles.headerBalance} />
          </View>

          <View style={styles.form}>
            <Text variant="h2" accessibilityRole="header" style={styles.centered}>Verify your phone</Text>
            <View style={styles.instructions}><Text variant="body" color="textMuted" style={styles.centered}>We’ve sent a 6-digit code to</Text><Text variant="bodyMedium" accessibilityLabel={`Phone number ending in ${phone.slice(-4)}`} style={styles.phone}>•••• {phone.slice(-4)}</Text></View>

            <View style={styles.codeEntry}>
              <Pressable accessible={false} disabled={busy} onPress={() => inputRef.current?.focus()}>
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.boxes}>
                  {Array.from({ length: 6 }, (_, index) => {
                    const active = focused && index === Math.min(code.length, 5);
                    return <View key={index} style={[styles.box, { backgroundColor: colors.surface, borderColor: error ? colors.danger : active ? colors.primary : colors.border, borderWidth: active ? 2 : 1 }]}>
                      {code[index] ? <Text variant="h3">{code[index]}</Text> : active ? <View style={[styles.caret, { backgroundColor: colors.primary }]} /> : null}
                    </View>;
                  })}
                </View>
                <TextInput ref={inputRef} accessibilityLabel="6-digit verification code" accessibilityHint="Enter or paste the code sent to your phone" value={code} onChangeText={onCodeChange} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} editable={!busy} keyboardType="number-pad" maxLength={6} autoFocus caretHidden textContentType="oneTimeCode" autoComplete="sms-otp" style={styles.hiddenInput} />
              </Pressable>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="Change phone number" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onChangeNumber} style={styles.changeNumber}><Text variant="button" color="primary">Change number →</Text></Pressable>
            {error ? <AppMessage message={error} style={styles.error} /> : null}
          </View>

          <View style={styles.footer}>
            <Button label="Verify" fullWidth size="lg" className="!rounded-xl" loading={loading} disabled={busy || code.length !== 6} onPress={onVerify} />
            <Pressable accessibilityRole="button" accessibilityLabel={resending ? 'Sending a new code' : seconds > 0 ? `Resend code in ${countdown}` : 'Resend code'} accessibilityState={{ disabled: busy || seconds > 0, busy: resending }} disabled={busy || seconds > 0} onPress={onResend} style={styles.resend}>
              <Text variant="caption" color={seconds > 0 || busy ? 'textMuted' : 'primary'} style={styles.centered}>{resending ? 'Sending code…' : seconds > 0 ? `Resend code in ${countdown}` : 'Resend code'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  frame: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 8 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerBalance: { width: 44 },
  form: { paddingHorizontal: 24, paddingTop: 52 },
  centered: { textAlign: 'center' },
  instructions: { alignItems: 'center', marginTop: 18, gap: 4 },
  phone: { textAlign: 'center', letterSpacing: 1 },
  codeEntry: { width: '100%', maxWidth: 352, alignSelf: 'center', marginTop: 32 },
  boxes: { flexDirection: 'row', gap: 8 },
  box: { flex: 1, minWidth: 0, height: 56, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  caret: { width: 2, height: 22, borderRadius: 1 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  changeNumber: { minHeight: 44, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  error: { textAlign: 'center', marginTop: 8 },
  footer: { marginTop: 'auto', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 18, gap: 8 },
  resend: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
