import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { apiErrorMessage } from '@/lib/apiClient';

const REASONS = ['Driver is taking too long', 'I no longer need the ride', 'Pickup details are incorrect'] as const;

interface TripCancellationModalProps {
  courier?: boolean;
  busy?: boolean;
  onKeep: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

/** Confirmation only. The caller remains responsible for cancelling the real trip. */
export function TripCancellationModal({ courier = false, busy = false, onKeep, onConfirm }: TripCancellationModalProps) {
  const { colors, scheme } = useTheme();
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const isBusy = busy || submitting;
  const cancelLabel = courier ? 'Cancel delivery' : 'Cancel ride';
  const keepLabel = courier ? 'Keep delivery' : 'Keep ride';
  const reasons = courier ? [REASONS[0], 'I no longer need the delivery', REASONS[2]] : REASONS;
  const keep = () => { if (!isBusy) onKeep(); };

  const confirm = async () => {
    if (inFlight.current || isBusy) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try { await onConfirm(reason); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  return <Modal visible transparent animationType="fade" accessibilityLabel={courier ? 'Cancel this delivery?' : 'Cancel this ride?'} onRequestClose={keep}>
    <Pressable onPress={keep} accessibilityRole="none" style={[nativeWindTheme[scheme], styles.backdrop, { backgroundColor: colors.overlay }]}>
      <Pressable onPress={event => event.stopPropagation()} accessibilityRole="none" accessibilityViewIsModal accessibilityLabel={courier ? 'Cancel this delivery?' : 'Cancel this ride?'} style={[styles.dialog, { backgroundColor: colors.surface }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.heading}><Text variant="bodyMedium">{courier ? 'Cancel this delivery?' : 'Cancel this ride?'}</Text><Text variant="caption" color="textMuted">Choose a reason to help us improve.</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close cancellation dialog" accessibilityState={{ disabled: isBusy }} disabled={isBusy} onPress={keep} style={styles.close}><RideIcon name="close" size={18} color="icon" /></Pressable>
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel="Cancellation reason" style={styles.reasons}>
            {reasons.map(item => {
              const selected = reason === item;
              return <Pressable key={item} accessibilityRole="radio" accessibilityLabel={item} accessibilityState={{ checked: selected, disabled: isBusy }} aria-checked={selected} disabled={isBusy} onPress={() => { setReason(item); setError(null); }} style={[styles.reason, { backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
                <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.borderStrong }]}>{selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}</View>
                <Text variant="caption" style={styles.reasonText}>{item}</Text>
              </Pressable>;
            })}
          </View>
          {error ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Button label={keepLabel} size="sm" fullWidth disabled={isBusy} onPress={keep} />
            <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel} accessibilityState={{ disabled: isBusy, busy: isBusy }} disabled={isBusy} onPress={() => void confirm()} style={[styles.cancel, { backgroundColor: colors.dangerSoft, opacity: isBusy ? 0.6 : 1 }]}>
              {isBusy ? <ActivityIndicator size="small" color={colors.danger} /> : null}
              <Text variant="button" color="danger">{isBusy ? 'Cancelling…' : cancelLabel}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '90%', borderRadius: 20, overflow: 'hidden' },
  scroll: { flexGrow: 0 },
  content: { padding: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  heading: { flex: 1, minWidth: 0, gap: 4, paddingTop: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  reasons: { gap: 8, marginTop: 16 },
  reason: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  reasonText: { flex: 1 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  error: { marginTop: 12 },
  actions: { marginTop: 18, gap: 8 },
  cancel: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
