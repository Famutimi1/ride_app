import { useEffect } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { closeConfirmation, dismissToast, useFeedbackStore } from '@/store/feedbackStore';
import { AppMessage } from './AppMessage';
import { Button } from './Button';
import { RideIcon } from './RideIcon';
import { Text } from './Text';

/** One host for native + web. Toasts stay below the top safe area, above the keyboard. */
export function FeedbackHost() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useFeedbackStore(state => state.toast);
  const dialog = useFeedbackStore(state => state.dialog);
  useEffect(() => {
    if (!toast) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
    // Errors persist until dismissed; important failures belong inline with a retry action.
    if (toast.tone === 'error') return;
    const timer = setTimeout(() => dismissToast(toast.id), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const toastView = toast ? <View pointerEvents="box-none" style={[styles.toastArea, { top: insets.top + 12 }]}>
    <View style={[styles.toast, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.copy}><AppMessage tone={toast.tone} message={toast.message} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => dismissToast(toast.id)} style={styles.close}><RideIcon name="close" size={16} /></Pressable>
    </View>
  </View> : null;

  return <>
    {!dialog ? toastView : null}
    <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={() => closeConfirmation(false)}>
      <SafeAreaView style={[styles.overlay, nativeWindTheme[scheme], { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close confirmation" onPress={() => closeConfirmation(false)} style={StyleSheet.absoluteFill} />
        {dialog ? <View accessibilityViewIsModal accessibilityLabel={dialog.title} onAccessibilityEscape={() => closeConfirmation(false)} style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={[styles.symbol, { backgroundColor: dialog.destructive ? colors.dangerSoft : colors.primarySoft }]}><RideIcon name={dialog.destructive ? 'close' : 'info'} size={20} color={dialog.destructive ? 'danger' : 'primary'} /></View>
            <Text variant="bodyMedium" accessibilityRole="header">{dialog.title}</Text>
            <Text variant="caption" color="textMuted">{dialog.message}</Text>
            <View style={styles.actions}>
              <Button label={dialog.confirmLabel ?? 'Confirm'} variant={dialog.destructive ? 'destructive' : 'primary'} fullWidth onPress={() => closeConfirmation(true)} />
              {dialog.cancelLabel ? <Button label={dialog.cancelLabel} variant="ghost" fullWidth onPress={() => closeConfirmation(false)} /> : null}
            </View>
          </ScrollView>
        </View> : null}
      </SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  toastArea: { position: 'absolute', left: 16, right: 16, zIndex: 1000, alignItems: 'center' },
  toast: { width: '100%', maxWidth: 460, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', elevation: 8 },
  copy: { flex: 1, minWidth: 0 }, close: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 380, maxHeight: '90%', borderRadius: 20, overflow: 'hidden' },
  content: { padding: 20, gap: 10 }, symbol: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: 8, gap: 4 },
});
