import { feedback } from '@/store/feedbackStore';
import { userErrorMessage } from '@/utils/userMessage';
import { AppMessage } from '@/components/common/AppMessage';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import type { AuthUser } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';
import { profileIdentityNotice } from '@/utils/profileIdentity';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';
import { PhoneChangeSection } from './PhoneChangeSection';

export function ProfileScreen() {
  const user = useAuthStore(state => state.session?.user);
  return <ProfileForm key={user?.id ?? 'signed-out'} user={user} />;
}

function ProfileForm({ user }: { user?: AuthUser }) {
  const router = useRouter();
  const application = useAuthStore(state => state.driverApplication);
  const trip = useTripStore(state => state.trip);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phoneExpanded, setPhoneExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const switchInFlight = useRef(false);
  const identityNotice = profileIdentityNotice(application?.status === 'approved', trip?.status);

  const save = async () => {
    if (saveInFlight.current || switchInFlight.current || !user || useAuthStore.getState().session?.user.id !== user.id) return;
    saveInFlight.current = true;
    setSaving(true); setError(null); setNotice(null);
    try {
      const locked = profileIdentityNotice(useAuthStore.getState().driverApplication?.status === 'approved', useTripStore.getState().trip?.status);
      await useAuthStore.getState().updateProfile({ ...(!locked ? { name } : {}), email });
      feedback.success('Your profile has been updated.');
    } catch (reason) { setError(userErrorMessage(reason, 'Could not save your profile. Please try again.')); }
    finally { saveInFlight.current = false; setSaving(false); }
  };

  const openApplication = async () => {
    if (switchInFlight.current || saveInFlight.current) return;
    const current = useAuthStore.getState().driverApplication;
    if (current?.status !== 'approved') {
      if (current && current.status !== 'draft') router.push('/driver-status');
      else router.push({ pathname: '/account/[section]', params: { section: 'earn' } });
      return;
    }
    switchInFlight.current = true; setSwitching(true); setError(null);
    try {
      const changed = await useAuthStore.getState().setRole('driver');
      if (changed) router.replace('/driver-dashboard');
    } catch (reason) { setError(userErrorMessage(reason, 'Could not switch to driver mode. Please try again.')); }
    finally { switchInFlight.current = false; setSwitching(false); }
  };

  const applicationDetail = application?.status === 'approved' ? 'Your driver account is ready.'
    : application?.status === 'pending' ? 'Your application is being reviewed.'
    : application?.status === 'rejected' ? 'Review the decision and update your application.'
    : 'Apply to receive nearby requests.';

  return <ProfileView avatarUrl={user?.avatarUrl} photoEditor={<ProfilePhotoEditor key={user?.id} locked={Boolean(profileIdentityNotice(false, trip?.status))} />} name={identityNotice ? user?.name ?? '' : name} email={email} displayName={user?.name ?? 'Your account'} phone={user?.phone ?? ''} role={user?.role ?? 'rider'}
    identityNotice={identityNotice} saving={saving} error={error} notice={notice} switching={switching}
    onName={setName} onEmail={setEmail} onSave={() => void save()}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')}
    onChangePhone={() => setPhoneExpanded(true)} phoneExpanded={phoneExpanded}
    phoneChange={!identityNotice && phoneExpanded ? <PhoneChangeSection onClose={() => setPhoneExpanded(false)} /> : null}
    application={user?.role !== 'driver' ? { detail: applicationDetail, action: application?.status === 'approved' ? 'Switch' : application && application.status !== 'draft' ? 'View' : 'Apply', onPress: () => void openApplication() } : null} />;
}

interface ProfileViewProps {
  avatarUrl?:string|null;photoEditor?:ReactNode;
  name: string; email: string; displayName: string; phone: string; role: AuthUser['role'];
  identityNotice: string | null; saving: boolean; switching: boolean; error: string | null; notice: string | null;
  phoneExpanded: boolean; phoneChange: ReactNode;
  onName: (value: string) => void; onEmail: (value: string) => void; onBack: () => void; onSave: () => void; onChangePhone: () => void;
  application: { detail: string; action: string; onPress: () => void } | null;
}

export function ProfileView(props: ProfileViewProps) {
  const { colors } = useTheme();
  const locked = Boolean(props.identityNotice);
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={props.onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header">Your profile</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {props.photoEditor ?? <View style={styles.summary}>
        <Avatar uri={props.avatarUrl} name={props.displayName} size="md" />
        <View style={styles.copy}><Text variant="bodyMedium">{props.displayName}</Text><Text variant="caption" color="textMuted">{props.role === 'driver' ? 'Driver' : 'Rider'}</Text></View>
      </View>}
      <Text variant="button" accessibilityRole="header" style={styles.heading}>Personal details</Text>
      <View style={styles.fields}>
        <ProfileField icon="passenger" label="Full name" value={props.name} onChangeText={props.onName} editable={!locked && !props.saving} locked={locked} autoCapitalize="words" autoComplete="name" />
        <ProfileField icon="mail" label="Email address" value={props.email} onChangeText={props.onEmail} editable={!props.saving} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
        <ProfileField icon="phone" label="Phone number" value={props.phone} editable={false} locked={locked}
          action={!locked ? <Pressable accessibilityRole="button" accessibilityLabel="Change phone number" accessibilityState={{ expanded: props.phoneExpanded, disabled: props.saving || props.phoneExpanded }} disabled={props.saving || props.phoneExpanded} onPress={props.onChangePhone} style={styles.change}><Text variant="caption" color="primary">Change</Text></Pressable> : undefined} />
      </View>
      {props.phoneChange}
      {props.identityNotice ? <View style={[styles.info, { backgroundColor: colors.primarySoft }]}><RideIcon name="safety" size={18} color="primary" /><Text variant="caption" style={styles.copy}>{props.identityNotice}</Text></View> : null}
      <Button label="Save changes" accessibilityLabel="Save changes" size="sm" fullWidth loading={props.saving} disabled={props.switching} onPress={props.onSave} className="mt-lg" />
      {props.error ? <AppMessage message={props.error} style={styles.feedback} /> : null}
      {props.notice ? <AppMessage tone="success" message={props.notice} style={styles.feedback} /> : null}
      {props.application ? <Pressable accessibilityRole="button" accessibilityLabel={`${props.application.action}: Drive with Rakky Ride`} accessibilityState={{ busy: props.switching, disabled: props.switching || props.saving }} disabled={props.switching || props.saving} onPress={props.application.onPress}
        style={[styles.application, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <RideIcon name="vehicle" size={18} color="primary" />
        <View style={styles.copy}><Text variant="button">Drive with Rakky Ride</Text><Text variant="caption" color="textMuted">{props.application.detail}</Text></View>
        <Text variant="caption" color="primary">{props.switching ? 'Switching…' : props.application.action}</Text>
      </Pressable> : null}
      <View style={[styles.account, { borderTopColor: colors.border }]}>
        <Text variant="button" accessibilityRole="header">Account</Text>
        <View accessibilityLabel="Delete account, unavailable" accessibilityState={{ disabled: true }} style={[styles.unavailable, { backgroundColor: colors.surfaceMuted, borderColor: colors.danger }]}>
          <RideIcon name="trash" size={18} color="textMuted" />
          <Text variant="button" color="textMuted" style={styles.copy}>Delete account</Text>
          <View style={[styles.badge, { backgroundColor: colors.border }]}><Text variant="caption" color="textMuted">Unavailable</Text></View>
        </View>
        <Text variant="caption" color="textMuted" style={styles.feedback}>Account deletion is temporarily unavailable.</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function ProfileField({ icon, label, locked = false, action, ...input }: ComponentProps<typeof TextInput> & { icon: ComponentProps<typeof RideIcon>['name']; label: string; locked?: boolean; action?: ReactNode }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={[styles.field, { backgroundColor: locked ? colors.surfaceMuted : colors.surface, borderColor: focused ? colors.primary : colors.border }]}>
    <RideIcon name={icon} size={18} color={locked ? 'textMuted' : 'text'} />
    <View style={styles.copy}>
      <Text variant="caption" color="textMuted">{label}</Text>
      <TextInput {...input} accessibilityLabel={label} accessibilityHint={locked ? 'Read-only identity detail' : undefined} selectionColor={colors.primary} placeholderTextColor={colors.textMuted}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="w-full border-0 p-0 font-inter-regular text-body text-text outline-none" />
    </View>
    {action ?? (locked ? <RideIcon name="lock" size={16} color="textMuted" /> : input.editable !== false ? <AddressIcon name="edit" size={16} color="textMuted" /> : null)}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.divider },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing['2xl'] },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  photoNote: { marginTop: spacing.sm },
  heading: { marginTop: spacing.xl, marginBottom: spacing.md },
  fields: { gap: spacing.sm },
  field: { minHeight: 64, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  change: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  info: { marginTop: spacing.md, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  feedback: { marginTop: spacing.sm },
  application: { marginTop: spacing.lg, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  account: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: borderWidths.divider },
  unavailable: { marginTop: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
});
