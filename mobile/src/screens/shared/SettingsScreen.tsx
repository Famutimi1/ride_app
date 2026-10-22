import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { ThemePreferencePicker } from '@/components/common/ThemePreferencePicker';
import { AddressIcon } from '@/components/map/AddressIcon';
import { DriverServicePreferences } from '@/components/common/DriverServiceSettings';
import { NotificationPreferencesPanel } from '@/components/notifications';
import { getSettingsContent, type SettingsDestination, type SettingsRole } from '@/constants/settings';
import { radius, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { settingsDestination } from '@/utils/settings';
import { LocationPermissionsPanel } from '@/components/settings/LocationPermissionsPanel';

export function SettingsScreen() {
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  return <SettingsController key={`${user?.id}:${role}`} userId={user?.id} role={role} />;
}

function SettingsController({ userId, role }: { userId?: string; role: SettingsRole }) {
  const router = useRouter();
  const logout = useAuthStore(state => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoutInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ownsScreen = () => {
    const user = useAuthStore.getState().session?.user;
    return mounted.current && Boolean(userId && user?.id === userId && user.role === role);
  };
  const signOut = async () => {
    if (logoutInFlight.current || !ownsScreen()) return;
    logoutInFlight.current = true;
    setLoggingOut(true); setError(null);
    try {
      await logout();
      if (!useAuthStore.getState().session) router.replace('/welcome');
    } catch {
      // Remote revocation may fail after local credentials were cleared.
      if (!useAuthStore.getState().session) router.replace('/welcome');
      else if (ownsScreen()) setError('Could not log out. Please try again.');
    } finally { logoutInFlight.current = false; if (mounted.current) setLoggingOut(false); }
  };
  const navigate = (destination: SettingsDestination) => {
    if (logoutInFlight.current || !ownsScreen()) return;
    const href = settingsDestination(destination, role);
    if (href) router.push(href);
  };
  return <SettingsView role={role} loggingOut={loggingOut} error={error} onNavigate={navigate} onLogout={() => void signOut()}
    onBack={() => {
      if (logoutInFlight.current) return;
      if (router.canGoBack()) router.back(); else router.replace('/menu');
    }} />;
}

interface SettingsViewProps {
  role: SettingsRole; loggingOut: boolean; error: string | null;
  onBack: () => void; onNavigate: (destination: SettingsDestination) => void; onLogout: () => void;
}

export function SettingsView({ role, loggingOut, error, onBack, onNavigate, onLogout }: SettingsViewProps) {
  const { colors } = useTheme();
  const content = getSettingsContent(role);
  const group = [styles.group, { borderColor: colors.border, backgroundColor: colors.surface }];
  return <SettingsPage title={content.title} backLabel="Back to account" onBack={onBack}>
    {role === 'rider' ? <>
      <Text variant="caption" color="textMuted">{content.intro}</Text>
      <SectionLabel>{content.section}</SectionLabel>
      <View style={group}>{content.entries.map((entry, index) => <SettingsRow key={entry.destination} icon={entry.icon} label={entry.label} detail={entry.detail} disabled={loggingOut} onPress={() => onNavigate(entry.destination)} last={index === content.entries.length - 1} />)}</View>
    </> : null}
    <SectionLabel>{role === 'driver' ? 'Appearance settings' : 'Appearance'}</SectionLabel>
    <ThemePreferencePicker />
    <SectionLabel>{role === 'driver' ? content.section : 'App preferences'}</SectionLabel>
    <View style={group}>
      {role === 'driver' ? content.entries.map(entry => <SettingsRow key={entry.destination} icon={entry.icon} label={entry.label} detail={entry.detail} disabled={loggingOut} onPress={() => onNavigate(entry.destination)} />) : null}
      <SettingsRow icon="bell" label={role === 'driver' ? 'Notification settings' : 'Rider notifications'} detail={role === 'driver' ? 'Offers, sound and vibration' : 'Ride, schedule and payment alerts'} disabled={loggingOut} onPress={() => onNavigate('notifications')} />
      <SettingsRow icon="location" label={content.locationTitle} detail={Platform.OS === 'web' ? 'Manage browser location access' : role === 'driver' ? 'Foreground and background access' : 'Find your pickup location'} disabled={loggingOut} onPress={() => onNavigate('location')} last={role === 'driver'} />
      {role === 'rider' ? <SettingsRow icon="clock" label="Notification history" detail="Your rider and account updates" disabled={loggingOut} onPress={() => onNavigate('history')} last /> : null}
    </View>
    {role === 'rider' ? <>
      <SectionLabel>Account & help</SectionLabel>
      <View style={group}>
        <SettingsRow icon="passenger" label="Profile & phone" detail="Your personal and contact details" disabled={loggingOut} onPress={() => onNavigate('profile')} />
        <SettingsRow icon="safety" label="Rider safety" detail="Safety tools for your rides" disabled={loggingOut} onPress={() => onNavigate('safety')} />
        <SettingsRow icon="support" label="Rider help & support" detail="Rides, payments and account help" disabled={loggingOut} onPress={() => onNavigate('support')} last />
      </View>
    </> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Log out" accessibilityState={{ disabled: loggingOut, busy: loggingOut }} disabled={loggingOut} onPress={onLogout} style={[styles.logout, { borderColor: colors.danger, opacity: loggingOut ? 0.5 : 1 }]}>
      {loggingOut ? <ActivityIndicator size="small" color={colors.danger} /> : <RideIcon name="logout" size={18} color="danger" />}
      <Text variant="button" color="danger">{loggingOut ? 'Logging out…' : 'Log out'}</Text>
    </Pressable>
    {error ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
  </SettingsPage>;
}

export function NotificationSettingsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  return <SettingsPage title={getSettingsContent(role).notificationTitle} backLabel="Back to settings" onBack={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/account/[section]', params: { section: 'settings' } })}>
    <NotificationPreferencesPanel key={`${user?.id}:${role}`} />
  </SettingsPage>;
}

export function LocationSettingsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  return <SettingsPage title={getSettingsContent(role).locationTitle} backLabel="Back to settings" onBack={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/account/[section]', params: { section: 'settings' } })}>
    <LocationPermissionsPanel key={`${user?.id}:${role}`} role={role} />
  </SettingsPage>;
}

export function DriverServicesSettingsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  if (user?.role !== 'driver') return <Redirect href={{ pathname: '/account/[section]', params: { section: 'settings' } }} />;
  return <SettingsPage title="Service settings" backLabel="Back to settings" onBack={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/account/[section]', params: { section: 'settings' } })}><DriverServicePreferences key={user.id} /></SettingsPage>;
}

function SettingsPage({ title, backLabel, onBack, children }: { title: string; backLabel: string; onBack: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>{title}</Text>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>{children}</ScrollView>
  </SafeAreaView>;
}

function SectionLabel({ children }: { children: string }) {
  return <Text variant="caption" color="textMuted" accessibilityRole="header" style={styles.section}>{children.toUpperCase()}</Text>;
}

function SettingsRow({ icon, label, detail, onPress, disabled = false, last = false }: { icon: ComponentProps<typeof RideIcon>['name']; label: string; detail: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.row, { opacity: disabled ? 0.5 : 1, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
    <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}><RideIcon name={icon} size={18} color="primary" /></View>
    <View style={styles.copy}><Text variant="button">{label}</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>{detail}</Text></View>
    <RideIcon name="chevron" size={16} color="textMuted" />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing['2xl'] }, section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  icon: { width: 32, height: 32, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 }, smallGap: { marginTop: spacing.xs },
  logout: { marginTop: spacing.xl, borderWidth: 1, borderRadius: radius.lg, minHeight: 48, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  notice: { marginTop: spacing.sm },
});
