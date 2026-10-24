import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';
import { formatNaira } from '@/services/paymentService';
import type { Trip } from '@/services/tripService';

export type DriverTripConfirmationAction = 'complete' | 'cancel' | 'return';

interface Props {
  trip: Trip;
  action: DriverTripConfirmationAction;
  busy: boolean;
  onClose: () => void;
  onConfirm: (deliveryCode?: string) => Promise<void>;
}

/** Real in-app confirmation on web and native; never settles a trip on opening. */
export function DriverTripConfirmation({ trip, action, busy, onClose, onConfirm }: Props) {
  const { colors, scheme } = useTheme();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || submitting;
  const courier = trip.service_type === 'courier';
  const returning = trip.status === 'returning';
  const needsCode = action === 'complete' && courier;
  const cancelling = action === 'cancel';
  const label = cancelling ? 'Cancel trip' : action === 'return' ? 'Start return to sender'
    : returning ? 'Confirm return' : courier ? 'Confirm delivery' : 'Complete trip';
  const detail = cancelling ? 'The rider or sender will be notified. Only cancel if you cannot continue.'
    : action === 'return' ? 'Contact the recipient and sender first. Return the package to pickup if handoff is not possible. The original delivery fare applies after the sender confirms the return.'
      : courier ? `Ask the ${returning ? 'sender' : 'recipient'} for the six-digit code after handing over the package.`
        : 'Confirm only after reaching the destination and the rider has left the vehicle.';
  const close = () => { if (!locked) onClose(); };
  const confirm = async () => {
    if (inFlight.current || locked) return;
    if (needsCode && !/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit handoff code.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try { await onConfirm(needsCode ? code.trim() : undefined); onClose(); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <SafeAreaView style={[styles.overlay, nativeWindTheme[scheme], { backgroundColor: colors.overlay }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss trip confirmation" disabled={locked} onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface }]}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={[styles.icon, { backgroundColor: cancelling ? colors.dangerSoft : colors.primarySoft }]}><RideIcon name={cancelling ? 'close' : action === 'return' ? 'swap' : 'check'} size={22} color={cancelling ? 'danger' : 'primary'} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close trip confirmation" disabled={locked} onPress={close} style={styles.close}><RideIcon name="close" size={19} /></Pressable>
            </View>
            <Text variant="bodyMedium" accessibilityRole="header">{label}?</Text>
            <Text variant="caption" color="textMuted" style={styles.detail}>{detail}</Text>
            {action === 'complete' ? <View style={[styles.payment, { backgroundColor: colors.surfaceMuted }]}>
              <RideIcon name={trip.payment_method === 'cash' ? 'cash' : trip.payment_method === 'card' ? 'card' : 'wallet'} color="primary" size={20} />
              <View style={styles.flex}><Text variant="caption" color="textMuted">{trip.payment_method === 'cash' ? 'Cash to collect' : 'Fare settled on completion'}</Text><Text variant="bodyMedium">{formatNaira(trip.fare_kobo)}</Text></View>
            </View> : null}
            {needsCode ? <Input label={returning ? 'Sender handoff code' : 'Recipient delivery code'} placeholder="Six-digit code" value={code} keyboardType="number-pad" maxLength={6} editable={!locked} onChangeText={value => { setCode(value.replace(/\D/g, '')); setError(null); }} /> : null}
            {error ? <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text> : null}
            <Button label={label} variant={cancelling ? 'destructive' : 'primary'} fullWidth loading={locked} onPress={() => void confirm()} />
            <Button label={cancelling ? 'Keep trip' : 'Not yet'} variant="ghost" fullWidth disabled={locked} onPress={close} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 }, keyboard: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', borderRadius: 22, overflow: 'hidden' },
  content: { padding: 20, gap: 12 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  detail: { marginTop: -4 }, payment: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 }, flex: { flex: 1 },
});
