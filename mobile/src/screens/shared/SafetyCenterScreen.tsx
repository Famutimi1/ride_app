import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { getCareContent, type CareArticle, type CareContent } from '@/constants/care';
import { careDestination, careServiceContext, careTripForRole } from '@/utils/careCenter';
import { radius, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useTripStore } from '@/store/tripStore';
import { hasShareableTrip, safetyTripShareMessage } from '@/utils/safetyCenter';

type EmergencyNumber = '112' | '767';

export function SafetyCenterScreen() {
  const user = useAuthStore(state => state.session?.user);
  const role = user?.role ?? 'rider';
  return <SafetyCenter key={`${user?.id}:${role}`} role={role} userId={user?.id} />;
}

function SafetyCenter({ role, userId }: { role: 'rider' | 'driver'; userId?: string }) {
  const router = useRouter();
  const rawTrip = useTripStore(state => state.trip);
  const trip = careTripForRole(rawTrip, userId, role);
  const services = useAuthStore(state => state.driverServices);
  const content = getCareContent(role, careServiceContext(services, trip));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [calling, setCalling] = useState<EmergencyNumber | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const callInFlight = useRef(false);
  const shareInFlight = useRef(false);

  const call = async (number: EmergencyNumber) => {
    if (callInFlight.current) return;
    callInFlight.current = true;
    setCalling(number);
    setCallError(null);
    try { await Linking.openURL(`tel:${number}`); }
    catch { if (mounted.current) setCallError(`Could not open a dialer. Call ${number}${number === '767' ? ' in Lagos' : ''} from your phone.`); }
    finally { callInFlight.current = false; if (mounted.current) setCalling(null); }
  };

  const share = async () => {
    if (shareInFlight.current) return;
    const session = useAuthStore.getState().session?.user;
    if (session?.id !== userId || session?.role !== role) return;
    const message = safetyTripShareMessage(careTripForRole(useTripStore.getState().trip, userId, role), role);
    if (!message) { setShareError('There is no active trip to share.'); return; }
    shareInFlight.current = true;
    setSharing(true);
    setShareError(null);
    try { await Share.share({ message }); }
    catch { if (mounted.current) setShareError('Could not open sharing. Please try again.'); }
    finally { shareInFlight.current = false; if (mounted.current) setSharing(false); }
  };

  return <SafetyCenterView role={role} content={content} activeTrip={hasShareableTrip(trip)} calling={calling} callError={callError} sharing={sharing} shareError={shareError}
    browser={Platform.OS === 'web'} onCall={number => void call(number)} onShare={() => void share()}
    onTrip={() => {
      const user = useAuthStore.getState().session?.user;
      if (user?.id !== userId || user?.role !== role) return;
      const current = careTripForRole(useTripStore.getState().trip, userId, role);
      if (current) router.push(careDestination('trip', role, current));
    }}
    onSupport={() => router.push({ pathname: '/account/[section]', params: { section: 'support', topic: 'safety' } })}
    onBack={() => router.canGoBack() ? router.back() : router.replace(trip ? careDestination('trip', role, trip) : '/menu')} />;
}

interface SafetyCenterViewProps {
  role?: 'rider' | 'driver'; content?: CareContent; onTrip?: () => void;
  activeTrip: boolean; calling: EmergencyNumber | null; callError: string | null;
  sharing: boolean; shareError: string | null; browser: boolean;
  onCall: (number: EmergencyNumber) => void; onShare: () => void; onSupport: () => void; onBack: () => void;
}

export function SafetyCenterView({ role = 'rider', content: suppliedContent, onTrip, activeTrip, calling, callError, sharing, shareError, browser, onCall, onShare, onSupport, onBack }: SafetyCenterViewProps) {
  const { colors } = useTheme();
  const content = suppliedContent ?? getCareContent(role, { passenger: role === 'rider', courier: false });
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text accessibilityRole="header" variant="bodyMedium" style={styles.headerTitle}>{content.safetyTitle}</Text><RideIcon name="safety" size={20} color="primary" />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.emergency, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
        <View style={styles.emergencyHeading}><View style={[styles.icon, { backgroundColor: colors.surface }]}><RideIcon name="phone" size={18} color="danger" /></View><View style={styles.copy}><Text variant="button" accessibilityRole="header">Emergency help</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>In immediate danger? Call public emergency services.</Text></View></View>
        <Button label="Call 112" accessibilityLabel="Call emergency services on 112" accessibilityHint="Opens your phone dialer" variant="destructive" size="sm" fullWidth className="mt-md" loading={calling === '112'} disabled={calling !== null} leftIcon={<RideIcon name="phone" size={18} color="textInverse" />} onPress={() => onCall('112')} />
        <Pressable accessibilityRole="button" accessibilityLabel="Call Lagos emergency line on 767" accessibilityHint="Lagos emergency number. Opens your phone dialer" accessibilityState={{ disabled: calling !== null, busy: calling === '767' }} disabled={calling !== null} onPress={() => onCall('767')} style={styles.lagosCall}>{calling === '767' ? <ActivityIndicator color={colors.danger} size="small" /> : <Text variant="caption" color="danger" style={styles.centered}>Lagos emergency line: 767</Text>}</Pressable>
        <Text variant="caption" color="textMuted" selectable style={styles.centered}>{browser ? 'If your browser cannot open a dialer, call 112 or 767 (Lagos) from your phone.' : 'Opens your phone dialer.'}</Text>
        {callError ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.smallGap}>{callError}</Text> : null}
      </View>

      <View style={styles.sectionHeading}><Text variant="button" accessibilityRole="header" style={styles.sectionTitle}>Your safety tools</Text><View style={[styles.tripBadge, { backgroundColor: activeTrip ? colors.primarySoft : colors.surfaceMuted }]}><Text variant="caption" color={activeTrip ? 'primary' : 'textMuted'}>{activeTrip ? 'Active trip' : 'No active trip'}</Text></View></View>
      <View style={[styles.tools, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {onTrip ? <SafetyTool icon="receipt" title="Current trip details" detail="Open the trip and its contact options." disabled={!activeTrip} onPress={onTrip} /> : null}
        <SafetyTool icon="share" title="Share trip details" detail={activeTrip ? role === 'driver' ? 'Share the trip reference and your vehicle details.' : 'Share pickup, destination and vehicle details.' : 'Available during an active trip.'} disabled={!activeTrip || sharing} busy={sharing} onPress={onShare} />
        {role === 'rider' ? <SafetyTool icon="trusted" title="Trusted contacts" detail="Coming soon" disabled locked /> : null}
        <SafetyTool icon="support" title={content.safetyContactTitle} detail="Open non-emergency contact options." onPress={onSupport} last />
      </View>
      {shareError ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.smallGap}>{shareError}</Text> : null}

      <Text variant="button" accessibilityRole="header" style={styles.guidanceHeading}>{content.safetyHeading}</Text>
      <View style={[styles.tools, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {content.tips.map((tip, index) => <SafetyTip key={tip.text} icon={tip.icon} text={tip.text} last={index === content.tips.length - 1} />)}
      </View>
      <Text variant="button" accessibilityRole="header" style={styles.guidanceHeading}>If something goes wrong</Text>
      <View style={[styles.tools, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {content.safetyArticles.map((article, index) => <SafetyGuidance key={article.id} article={article} last={index === content.safetyArticles.length - 1} />)}
      </View>
      <View style={styles.footer}><RideIcon name="safety" size={18} color="primary" /><Text variant="caption" color="textMuted" style={styles.footerText}>Safety tools, clearly within reach.</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

function SafetyGuidance({ article, last }: { article: CareArticle; last: boolean }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <View style={{ borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }}>
    <Pressable accessibilityRole="button" accessibilityLabel={article.question} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(value => !value)} style={styles.tip}>
      <Text variant="caption" style={styles.copy}>{article.question}</Text><RideIcon name={expanded ? 'minus' : 'plus'} size={16} color="icon" />
    </Pressable>
    {expanded ? <Text variant="caption" color="textMuted" style={styles.answer}>{article.answer}</Text> : null}
  </View>;
}

type SafetyIcon = ComponentProps<typeof RideIcon>['name'];
function SafetyTool({ icon, title, detail, disabled = false, busy = false, locked = false, last = false, onPress }: { icon: SafetyIcon; title: string; detail: string; disabled?: boolean; busy?: boolean; locked?: boolean; last?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} style={[styles.tool, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
    <View style={[styles.icon, { backgroundColor: disabled ? colors.surfaceMuted : colors.primarySoft }]}><RideIcon name={icon} size={18} color={disabled ? 'icon' : 'primary'} /></View>
    <View style={styles.copy}><Text variant="button">{title}</Text><Text variant="caption" color="textMuted" style={styles.smallGap}>{detail}</Text></View>
    {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <RideIcon name={locked ? 'lock' : 'chevron'} size={16} color={disabled ? 'icon' : 'primary'} />}
  </Pressable>;
}

function SafetyTip({ icon, text, last = false }: { icon: SafetyIcon; text: string; last?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.tip, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}><View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} /></View><Text variant="caption" style={styles.copy}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 48, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1 },
  content: { padding: spacing.lg }, emergency: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md },
  emergencyHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, icon: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 }, smallGap: { marginTop: spacing.xs }, centered: { textAlign: 'center' },
  lagosCall: { minHeight: 44, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.md }, sectionTitle: { flexGrow: 1 },
  tripBadge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, tools: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 68 }, guidanceHeading: { marginTop: spacing.xl, marginBottom: spacing.md },
  tip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  answer: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.sm }, footerText: { flexShrink: 1, textAlign: 'center' },
});
