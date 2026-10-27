import { AppMessage } from '@/components/common/AppMessage';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { getCareContent, type CareContent, type CareDestination } from '@/constants/care';
import { careDestination, careServiceContext, careTripForRole, supportContactUrl } from '@/utils/careCenter';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { getSupportSettings, type SupportSettings } from '@/services/careService';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';

type ContactAction = 'phone' | 'email';

export function HelpSupportScreen() {
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  return <HelpSupport key={`${user?.id}:${role}:${topic === 'safety'}`} role={role} userId={user?.id} safety={topic === 'safety'} />;
}

function HelpSupport({ role, userId, safety }: { role: 'rider' | 'driver'; userId?: string; safety: boolean }) {
  const router = useRouter();
  const rawTrip = useTripStore(state => state.trip);
  const trip = careTripForRole(rawTrip, userId, role);
  const services = useAuthStore(state => state.driverServices);
  const content = getCareContent(role, careServiceContext(services, trip));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<ContactAction | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const request = useRef({ generation: 0 });
  const openingInFlight = useRef(false);

  const refresh = useCallback(() => {
    const generation = ++request.current.generation;
    return getSupportSettings().then(value => {
      if (generation === request.current.generation) { setSettings(value); setError(null); }
    }, () => {
      if (generation === request.current.generation) setError('Could not load contact details. Please try again.');
    }).finally(() => { if (generation === request.current.generation) setLoading(false); });
  }, []);

  useEffect(() => {
    void refresh();
    const control = request.current;
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') { setLoading(true); void refresh(); }
    });
    return () => { control.generation++; listener.remove(); };
  }, [refresh]);

  const contact = async (action: ContactAction) => {
    if (openingInFlight.current || loading) return;
    const user = useAuthStore.getState().session?.user;
    if (user?.id !== userId || user?.role !== role || !mounted.current) return;
    const value = (action === 'phone' ? settings?.phone : settings?.email)?.trim();
    if (!value) return;
    openingInFlight.current = true;
    setOpening(action);
    setOpenError(null);
    try { await Linking.openURL(supportContactUrl(action, value, role, safety)); }
    catch { if (mounted.current) setOpenError(`Could not open your ${action === 'phone' ? 'phone' : 'email'} app. Use the contact details shown here.`); }
    finally { openingInFlight.current = false; if (mounted.current) setOpening(null); }
  };

  const navigate = (destination: CareDestination) => {
    const user = useAuthStore.getState().session?.user;
    if (user?.id !== userId || user?.role !== role) return;
    const current = careTripForRole(useTripStore.getState().trip, userId, role);
    if (current && destination !== 'trip') return;
    router.push(careDestination(destination, role, current));
  };

  return <HelpSupportView content={content} safety={safety} onNavigate={navigate} driver={role === 'driver'} tripPresent={Boolean(trip)} settings={settings} loading={loading} error={error} opening={opening} openError={openError}
    onRefresh={() => { setLoading(true); setOpenError(null); void refresh(); }} onContact={action => void contact(action)}
    onTrip={() => navigate('trip')} onWallet={() => navigate('wallet')} onAccount={() => navigate('account')}
    onSafety={() => router.push({ pathname: '/account/[section]', params: { section: 'safety' } })}
    onBack={() => router.canGoBack() ? router.back() : router.replace(trip ? careDestination('trip', role, trip) : '/menu')} />;
}

interface HelpSupportViewProps {
  content?: CareContent; safety?: boolean; onNavigate?: (destination: CareDestination) => void;
  driver: boolean; tripPresent: boolean; settings: SupportSettings | null; loading: boolean; error: string | null;
  opening: ContactAction | null; openError: string | null; onContact: (action: ContactAction) => void;
  onRefresh: () => void; onTrip: () => void; onWallet: () => void; onAccount: () => void; onSafety: () => void; onBack: () => void;
}

export function HelpSupportView({ content: suppliedContent, safety = false, onNavigate, driver, tripPresent, settings, loading, error, opening, openError, onContact, onRefresh, onTrip, onWallet, onAccount, onSafety, onBack }: HelpSupportViewProps) {
  const { colors } = useTheme();
  const content = suppliedContent ?? getCareContent(driver ? 'driver' : 'rider', { passenger: true, courier: false });
  const navigate = (destination: CareDestination) => {
    if (onNavigate) { onNavigate(destination); return; }
    if (destination === 'wallet') onWallet(); else if (destination === 'account') onAccount(); else if (destination === 'trip' || destination === 'history') onTrip();
  };
  const phone = settings?.phone?.trim();
  const email = settings?.email?.trim();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}><Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>{content.supportTitle}</Text></View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.welcome, { backgroundColor: colors.primarySoft }]}><View style={[styles.icon, { backgroundColor: colors.surface }]}><RideIcon name="support" size={18} color="primary" /></View><View style={styles.copy}><Text variant="bodyMedium">How can we help?</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>{content.supportIntro}</Text></View></View>
      {safety ? <View style={[styles.contact, { backgroundColor: colors.warningSoft }]}>
        <Text variant="button" accessibilityRole="header">{content.safetyContactTitle}</Text>
        <Text variant="caption" color="textMuted" style={styles.smallGap}>{content.safetyContactDetail}</Text>
        <Text variant="caption" color="textMuted" style={styles.smallGap}>Choose a contact option below and include your trip reference.</Text>
      </View> : null}
      <Text variant="button" accessibilityRole="header" style={styles.heading}>Helpful shortcuts</Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {tripPresent ? <SupportShortcut icon="vehicle" label="Your current trip" onPress={onTrip} /> : null}
        {content.shortcuts.map((shortcut, index) => <SupportShortcut key={shortcut.destination} icon={shortcut.icon} label={shortcut.label} onPress={() => navigate(shortcut.destination)} disabled={tripPresent} last={index === content.shortcuts.length - 1} />)}
      </View>
      {tripPresent ? <Text variant="caption" color="textMuted" style={styles.smallGap}>Other account shortcuts are available after your current trip.</Text> : null}
      <Text variant="button" accessibilityRole="header" style={styles.heading}>Quick answers</Text>
      <View key={driver ? 'driver' : 'rider'} style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {content.answers.map((article, index) => <QuickAnswer key={article.id} question={article.question} answer={article.answer} last={index === content.answers.length - 1} />)}
      </View>
      <View style={[styles.contact, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.contactHeading}><View style={[styles.icon, { backgroundColor: colors.surface }]}><RideIcon name="support" size={18} color="primary" /></View><Text variant="button" accessibilityRole="header" style={styles.copy}>{driver ? 'Contact driver support' : 'Contact rider support'}</Text></View>
        {settings ? <View style={styles.contactCopy}>
          {error ? <Text variant="caption" color="textMuted">Showing last loaded contact details.</Text> : null}
          <Text variant="caption">{settings.availabilityMessage.trim() || 'Support availability has not been provided.'}</Text>
          {settings.staffedHours.trim() ? <Text variant="caption" color="textMuted">{settings.staffedHours}</Text> : null}
          {phone ? <Text selectable variant="caption">{phone}</Text> : null}
          {email ? <Text selectable variant="caption">{email}</Text> : null}
        </View> : loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} size="small" /><Text variant="caption" color="textMuted">Loading contact details…</Text></View> : <Text variant="caption" color="textMuted" style={styles.contactCopy}>Contact details unavailable.</Text>}
        {error ? <AppMessage message={error} style={styles.smallGap} /> : null}
        {phone ? <Button label="Call support" size="sm" fullWidth className="mt-md" disabled={loading || opening !== null} loading={opening === 'phone'} leftIcon={<RideIcon name="phone" size={16} color="textInverse" />} onPress={() => onContact('phone')} /> : null}
        {email ? <Button label="Email support" size="sm" variant="outline" fullWidth className="mt-sm" disabled={loading || opening !== null} loading={opening === 'email'} leftIcon={<RideIcon name="mail" size={16} color="primary" />} onPress={() => onContact('email')} /> : null}
        {openError ? <AppMessage message={openError} style={styles.smallGap} /> : null}
        <Button label={error ? 'Retry contact details' : 'Refresh contact details'} size="sm" variant="outline" fullWidth className="mt-md" loading={loading} disabled={opening !== null} leftIcon={<RideIcon name="refresh" size={16} color="primary" />} onPress={onRefresh} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Need urgent help? Open Safety Center" onPress={onSafety} style={[styles.urgent, { borderColor: colors.danger, backgroundColor: colors.dangerSoft }]}><View style={[styles.icon, { backgroundColor: colors.surface }]}><RideIcon name="safety" size={18} color="danger" /></View><View style={styles.copy}><Text variant="button">Need urgent help?</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>Open Safety Center</Text></View><RideIcon name="chevron" size={16} color="danger" /></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

type SupportIcon = ComponentProps<typeof RideIcon>['name'];
function SupportShortcut({ icon, label, onPress, disabled = false, last = false }: { icon: SupportIcon; label: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={disabled ? 'Available after your current trip' : undefined} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.shortcut, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : borderWidths.divider }]}><View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} color="icon" /></View><Text variant="button" color={disabled ? 'textMuted' : 'text'} style={styles.copy}>{label}</Text><RideIcon name={disabled ? 'lock' : 'chevron'} size={16} color="icon" /></Pressable>;
}

function QuickAnswer({ question, answer, last = false }: { question: string; answer: string; last?: boolean }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <View style={{ borderBottomColor: colors.border, borderBottomWidth: last ? 0 : borderWidths.divider }}><Pressable accessibilityRole="button" accessibilityLabel={question} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(value => !value)} style={styles.question}><Text variant="caption" style={styles.copy}>{question}</Text><RideIcon name={expanded ? 'minus' : 'plus'} size={16} color="icon" /></Pressable>{expanded ? <Text variant="caption" color="textMuted" style={styles.answer}>{answer}</Text> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.divider }, back: { width: 48, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg }, welcome: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl }, icon: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 }, smallGap: { marginTop: spacing.xs },
  heading: { marginTop: spacing.lg, marginBottom: spacing.md }, group: { borderRadius: radius.xl, borderWidth: borderWidths.divider, overflow: 'hidden' }, shortcut: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  question: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, answer: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  contact: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.xl }, contactHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, contactCopy: { marginTop: spacing.sm, gap: spacing.sm }, loading: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  urgent: { marginTop: spacing.lg, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl, borderWidth: borderWidths.divider },
});
