import { userErrorMessage } from '@/utils/userMessage';
import { AppMessage } from '@/components/common/AppMessage';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { getAlertPreferences, type SettingsRole } from '@/constants/settings';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { configureNotificationChannels, notificationPermissionMessage, registerCurrentDevice, requestNotificationPermission, type NotificationPermissionState, type NotificationPreferences } from '@/services/notificationService';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';

export function NotificationPreferencesPanel() {
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  return <RoleNotificationPreferences key={`${user?.id}:${role}`} userId={user?.id} role={role} />;
}

function RoleNotificationPreferences({ userId, role }: { userId?: string; role: SettingsRole }) {
  const router = useRouter();
  const preferences = useNotificationStore(state => state.preferences);
  const permission = useNotificationStore(state => state.permission);
  const refresh = useNotificationStore(state => state.refreshPreferences);
  const save = useNotificationStore(state => state.savePreferences);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => {
    const user = useAuthStore.getState().session?.user;
    return mounted.current && Boolean(userId && user?.id === userId && user.role === role);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try { await refresh(); if (active) setLoadError(null); }
      catch { if (active) setLoadError('Could not load notification settings. Check your connection and try again.'); }
    };
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; subscription.remove(); };
  }, [refresh]);

  const change = async (key: keyof NotificationPreferences, value: boolean) => {
    if (inFlight.current || !preferences || !isCurrent()) return;
    if (!['pushEnabled', 'soundEnabled', 'vibrationEnabled'].includes(key) && !getAlertPreferences(role).some(entry => entry.key === key)) return;
    if (key === 'pushEnabled' && (!permission || permission.status === 'unsupported' || permission.status === 'unavailable')) return;
    inFlight.current = true;
    setSaving(key);
    setChangeError(null);
    try {
      if (key === 'pushEnabled' && value) {
        const vibration = preferences.vibrationEnabled;
        const result = await requestNotificationPermission(vibration);
        if (!isCurrent()) return;
        await refresh();
        if (!isCurrent()) return;
        if (!result.granted) { setChangeError(notificationPermissionMessage(result)); return; }
        await registerCurrentDevice(false, vibration);
      }
      if (!isCurrent()) return;
      await save({ [key]: value });
      if (!isCurrent()) return;
      if (key === 'vibrationEnabled') await configureNotificationChannels(value);
      await refresh();
    } catch (error) {
      if (isCurrent()) setChangeError(userErrorMessage(error, 'Could not update notification settings. Please try again.'));
    } finally { inFlight.current = false; if (mounted.current) setSaving(null); }
  };
  const retry = () => {
    setLoadError(null);
    void refresh().catch(() => setLoadError('Could not load notification settings. Check your connection and try again.'));
  };
  const openSettings = () => {
    void Linking.openSettings().catch(() => setChangeError('Open your device settings and select Rakky Ride, then Notifications.'));
  };
  return <NotificationPreferencesView driver={role === 'driver'} preferences={preferences} permission={permission} saving={saving} loadError={loadError} changeError={changeError}
    onChange={(key, value) => void change(key, value)} onRetry={retry} onDeviceSettings={openSettings} onHistory={() => router.push('/notification-center')} />;
}

interface NotificationPreferencesViewProps {
  driver: boolean; preferences: NotificationPreferences | null; permission: NotificationPermissionState | null;
  saving: keyof NotificationPreferences | null; loadError: string | null; changeError: string | null;
  onChange: (key: keyof NotificationPreferences, value: boolean) => void; onRetry: () => void; onDeviceSettings: () => void; onHistory: () => void;
}

export function NotificationPreferencesView({ driver, preferences, permission, saving, loadError, changeError, onChange, onRetry, onDeviceSettings, onHistory }: NotificationPreferencesViewProps) {
  const { colors } = useTheme();
  if (!preferences) return <View style={[styles.loading, { backgroundColor: colors.surfaceMuted }]}>
    {!loadError ? <ActivityIndicator size="small" color={colors.primary} /> : null}
    <Text variant="caption" color={loadError ? 'danger' : 'textMuted'} accessibilityRole={loadError ? 'alert' : undefined}>{loadError ?? 'Loading notification settings…'}</Text>
    {loadError ? <Button label="Try again" size="sm" variant="outline" onPress={onRetry} /> : null}
  </View>;

  const unavailable = permission?.status === 'unsupported' || permission?.status === 'unavailable';
  const canRequest = permission !== null && !permission.granted && !unavailable && permission.canAskAgain;
  const needsSettings = permission !== null && !permission.granted && !unavailable && !permission.canAskAgain;
  const disabled = saving !== null;
  const groupStyle = [styles.group, { backgroundColor: colors.surface, borderColor: colors.border }];
  return <View>
    {loadError ? <View style={styles.error}><AppMessage message={loadError} /><Button label="Try again" size="sm" variant="outline" disabled={disabled} onPress={onRetry} /></View> : null}
    <View style={[styles.push, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <View style={styles.rowContent}>
        <View style={[styles.icon, { backgroundColor: colors.surface }]}><RideIcon name="bell" size={18} color="textMuted" /></View>
        <Text variant="button" style={styles.copy}>Push notifications</Text>
        <PreferenceSwitch label="Push notifications" value={preferences.pushEnabled && permission?.granted === true} disabled={disabled || permission === null || unavailable} onChange={value => onChange('pushEnabled', value)} />
      </View>
      <Text variant="caption" color="textMuted" style={styles.pushMessage}>{notificationPermissionMessage(permission)}</Text>
      {permission?.unavailableReason === 'browser' ? <Text variant="caption" color="textMuted" style={styles.pushMessage}>Unavailable on web</Text> : null}
      {canRequest ? <Button label="Allow notifications" variant="ghost" size="sm" className="mt-xs self-start" disabled={disabled} onPress={() => onChange('pushEnabled', true)} /> : null}
      {needsSettings ? <Button label="Open device settings" variant="ghost" size="sm" className="mt-xs self-start" disabled={disabled} onPress={onDeviceSettings} /> : null}
    </View>
    {changeError ? <AppMessage message={changeError} style={styles.message} /> : null}
    {saving ? <View accessibilityLiveRegion="polite" style={styles.saving}><ActivityIndicator size="small" color={colors.primary} /><Text variant="caption" color="textMuted">Saving preference…</Text></View> : null}
    <Text variant="caption" color="textMuted" accessibilityRole="header" style={styles.heading}>UPDATES</Text>
    <View style={groupStyle}>
      {getAlertPreferences(driver ? 'driver' : 'rider').map((entry, index, entries) => <PreferenceRow key={entry.key} icon={entry.icon} label={entry.label} detail={entry.detail} value={preferences[entry.key]} disabled={disabled} onChange={value => onChange(entry.key, value)} last={index === entries.length - 1} />)}
    </View>
    <Text variant="caption" color="textMuted" accessibilityRole="header" style={styles.heading}>ALERT OPTIONS</Text>
    <View style={groupStyle}>
      <PreferenceRow icon="sound" label="Sound" detail="Play a sound for eligible notifications" value={preferences.soundEnabled} disabled={disabled} onChange={value => onChange('soundEnabled', value)} />
      <PreferenceRow icon="vibration" label="Vibration" detail="Vibrate for time-sensitive notifications" value={preferences.vibrationEnabled} disabled={disabled} onChange={value => onChange('vibrationEnabled', value)} last />
    </View>
    <Text variant="caption" color="textMuted" style={styles.message}>Trip, wallet and general alert preferences apply to both modes.</Text>
    <View style={styles.safety}><RideIcon name="safety" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Safety notices stay in your notification history.</Text></View>
    {!driver ? <Pressable accessibilityRole="button" accessibilityLabel="Open notification history" onPress={onHistory} style={[styles.history, { borderColor: colors.border, backgroundColor: colors.surface }]}><Text variant="button" color="primary" style={styles.copy}>Open notification history</Text><RideIcon name="chevron" size={16} color="textMuted" /></Pressable> : null}
  </View>;
}

function PreferenceSwitch({ label, detail, value, disabled, onChange }: { label: string; detail?: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  if (Platform.OS === 'web') return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ checked: value, disabled }} aria-checked={value} disabled={disabled} onPress={() => onChange(!value)} style={[styles.switchTarget, { opacity: disabled ? 0.5 : 1 }]}>
    <View style={[styles.switchTrack, { backgroundColor: value ? colors.primary : colors.borderStrong, alignItems: value ? 'flex-end' : 'flex-start' }]}><View style={[styles.switchThumb, { backgroundColor: value ? colors.textInverse : colors.surface }]} /></View>
  </Pressable>;
  return <View style={styles.switchTarget}><Switch accessibilityLabel={label} accessibilityHint={detail} hitSlop={8} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={value ? colors.textInverse : colors.surface} /></View>;
}

function PreferenceRow({ icon, label, detail, value, disabled, onChange, last = false }: { icon: ComponentProps<typeof RideIcon>['name']; label: string; detail: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void; last?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.preference, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : borderWidths.divider }]}>
    <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}><RideIcon name={icon} size={18} color="primary" /></View>
    <Text variant="caption" style={styles.copy}>{label}</Text>
    <PreferenceSwitch label={label} detail={detail} value={value} disabled={disabled} onChange={onChange} />
  </View>;
}

const styles = StyleSheet.create({
  loading: { padding: spacing.lg, borderRadius: radius.xl, gap: spacing.md },
  error: { gap: spacing.sm, marginBottom: spacing.md },
  push: { padding: spacing.md, borderRadius: radius.xl, borderWidth: 1 },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 32, height: 32, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  pushMessage: { marginTop: spacing.sm },
  heading: { marginTop: spacing.xl, marginBottom: spacing.sm },
  group: { borderWidth: 1, borderRadius: radius.xl, overflow: 'hidden' },
  preference: { paddingHorizontal: spacing.md, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchTarget: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  switchTrack: { width: 40, height: 24, padding: 3, borderRadius: radius.full, justifyContent: 'center' },
  switchThumb: { width: 18, height: 18, borderRadius: radius.full },
  message: { marginTop: spacing.sm },
  saving: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginVertical: spacing.md },
  history: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg },
});
