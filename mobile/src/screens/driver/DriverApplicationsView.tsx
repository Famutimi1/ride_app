import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { DriverVehicleSummary } from '@/components/common/DriverVehicleSummary';
import { AddressIcon } from '@/components/map/AddressIcon';
import { useTheme } from '@/constants/theme';
import type { DriverApplicationResponse, DriverService, DriverServiceSettings } from '@/services/driverService';
import { applicationDate, applicationDecision, type ServiceApplicationChoice, validServiceApplication } from '@/utils/driverApplications';
import { canApplyForDriverService, driverServiceStatus, driverVehicleServices, driverVehicleNeedsReview } from '@/utils/driverServices';

type Icon = ComponentProps<typeof RideIcon>['name'];
const SERVICES = ['ride', 'courier'] as const;
const serviceName = (service: DriverService) => service === 'ride' ? 'Passenger rides' : 'Courier deliveries';
const SURFACE = { success: 'successSoft', danger: 'dangerSoft', warning: 'warningSoft' } as const;

function ApplicationPage({ title, busy = false, refreshing = false, onBack, onRefresh, children }: { title: string; busy?: boolean; refreshing?: boolean; onBack: () => void; onRefresh?: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={onBack} style={[styles.circle, { backgroundColor: colors.surfaceMuted, opacity: busy ? 0.5 : 1 }]}><AddressIcon name="back" size={20} /></Pressable><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>{title}</Text>{onRefresh ? <Pressable accessibilityRole="button" accessibilityLabel="Refresh application status" accessibilityState={{ disabled: busy || refreshing, busy: refreshing }} disabled={busy || refreshing} onPress={onRefresh} style={[styles.circle, { backgroundColor: colors.surfaceMuted }]}>{refreshing ? <ActivityIndicator color={colors.primary} size="small" /> : <RideIcon name="refresh" size={18} />}</Pressable> : null}</View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>{children}</ScrollView>
  </SafeAreaView>;
}

export function ApplicationAction({ label, icon, onPress, outline = false, busy = false, disabled = false }: { label: string; icon?: Icon; onPress: () => void; outline?: boolean; busy?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  const blocked = disabled || busy;
  const color = blocked ? 'textMuted' : outline ? 'primary' : 'textInverse';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: blocked, busy }} disabled={blocked} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: blocked ? colors.surfaceMuted : outline ? colors.surface : colors.primary, borderColor: blocked ? colors.border : colors.primary, opacity: pressed ? 0.8 : 1 }]}>{busy ? <ActivityIndicator size="small" color={colors[color]} /> : <>{icon ? <RideIcon name={icon} size={18} color={color} /> : null}<Text variant="button" color={color} style={styles.actionText}>{label}</Text></>}</Pressable>;
}

function Card({ children, mint = false }: { children: ReactNode; mint?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.card, mint ? styles.mintCard : null, { backgroundColor: mint ? colors.primarySoft : colors.surface, borderColor: mint ? colors.primarySoft : colors.border }]}>{children}</View>;
}
function Heading({ children }: { children: string }) { return <Text variant="button" accessibilityRole="header">{children}</Text>; }
function Notice({ children, icon = 'info' }: { children: string; icon?: Icon }) {
  const { colors } = useTheme();
  return <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={17} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>{children}</Text></View>;
}
function Feedback({ loading, error, onRetry }: { loading?: boolean; error?: string | null; onRetry: () => void }) {
  const { colors } = useTheme();
  return <View style={styles.stack}>{loading ? <View style={styles.feedback}><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted">Loading application details…</Text></View> : null}{error ? <><Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text><ApplicationAction label="Reload application details" outline onPress={onRetry} /></> : null}</View>;
}

export function ServiceApprovalRows({ settings, hideNone = false }: { settings: DriverServiceSettings; hideNone?: boolean }) {
  const { colors } = useTheme();
  const services = driverVehicleServices(settings.vehicleCategory).filter(service => !hideNone || settings.services[service].status !== 'none');
  if (!services.length) return <Notice>No services requested yet.</Notice>;
  return <Card>{services.map((service, index) => {
    const state = settings.services[service];
    const tone = state.status === 'suspended' || state.status === 'rejected' ? 'danger' : state.status === 'pending' || (state.status === 'approved' && !state.consentAccepted) ? 'warning' : state.status === 'approved' ? 'success' : 'textMuted';
    const surface = tone === 'textMuted' ? 'surfaceMuted' : SURFACE[tone];
    return <View key={service} style={[styles.serviceRow, { borderBottomColor: colors.border, borderBottomWidth: index === services.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={styles.inline}><View style={[styles.iconBox, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={service === 'ride' ? 'vehicle' : 'package'} size={18} color="primary" /></View><Text variant="button" style={styles.copy}>{serviceName(service)}</Text><View style={[styles.badge, { backgroundColor: colors[surface] }]}><Text variant="caption" color={tone}>{driverServiceStatus(state)}</Text></View></View>
      {state.review?.reason ? <Text variant="caption" color="textMuted" style={styles.reason}>{state.review.reason}</Text> : null}
    </View>;
  })}</Card>;
}

interface StatusViewProps {
  data: DriverApplicationResponse | null; loading: boolean; error: string | null; busy: boolean;
  onRefresh: () => void; onBack: () => void; onPrimary: () => void; onServices: () => void; onSupport: () => void;
}
export function DriverApplicationStatusView({ data, loading, error, busy, onRefresh, onBack, onPrimary, onServices, onSupport }: StatusViewProps) {
  const { colors } = useTheme();
  const decision = data ? applicationDecision(data) : null;
  const category = data?.serviceSettings.vehicleCategory;
  return <ApplicationPage title="Application status" onBack={onBack} onRefresh={onRefresh} refreshing={loading} busy={busy}>
    {!data || error ? <Feedback loading={loading && !error} error={error} onRetry={onRefresh} /> : decision ? <>
      <View style={[styles.summary, { backgroundColor: colors[SURFACE[decision.tone]] }]}><View style={[styles.summaryIcon, { backgroundColor: colors.surface }]}><RideIcon name={decision.icon} size={24} color={decision.tone} /></View><View style={styles.copy}><Text variant="bodyMedium">{decision.title}</Text><Text variant="caption" color="textMuted" style={styles.subtitle}>{decision.detail}</Text></View></View>
      <View style={styles.stack}><Heading>Application summary</Heading><Card><MetadataRow label="Submitted" value={applicationDate(data.submitted_at)} icon="calendar" /><MetadataRow label="Reviewed" value={data.status === 'pending' && !data.reviewed_at ? 'Not reviewed yet' : applicationDate(data.reviewed_at)} icon="receipt" /><MetadataRow label="Vehicle category" value={category === 'car' ? 'Car' : category === 'motorcycle' ? 'Motorcycle' : 'Awaiting classification'} icon="vehicle" last /></Card></View>
      <View style={styles.stack}><Heading>Service approvals</Heading><ServiceApprovalRows settings={data.serviceSettings} /><View style={styles.inline}><RideIcon name="info" size={15} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>{category === 'motorcycle' ? 'Motorcycles are eligible for courier only.' : 'Ride and courier are reviewed separately for the same car.'}</Text></View></View>
      {data.status === 'approved' ? <Notice icon="menu">Choose which approved requests you receive from your dashboard.</Notice> : data.status === 'pending' ? <Notice>You can continue booking rides while you wait.</Notice> : null}
      <View style={styles.stack}>{data.status === 'approved' ? <ApplicationAction label="Service applications" icon="package" outline disabled={busy} onPress={onServices} /> : null}<ApplicationAction label={decision.action} icon={decision.destination === 'dashboard' ? 'vehicle' : decision.destination === 'support' ? 'support' : undefined} busy={busy} onPress={onPrimary} /></View>
    </> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Help & support" disabled={busy} onPress={onSupport} style={styles.help}><RideIcon name="support" color="primary" size={17} /><Text variant="button" color="primary">Help & support</Text></Pressable>
  </ApplicationPage>;
}
function MetadataRow({ label, value, icon, last = false }: { label: string; value: string; icon: Icon; last?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.metadata, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}><View style={[styles.iconBox, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} color="primary" /></View><View style={styles.copy}><Text variant="caption" color="textMuted">{label}</Text><Text variant="button">{value}</Text></View></View>;
}

interface EnrollmentViewProps {
  settings: DriverServiceSettings | null; loading: boolean; error: string | null; busy: boolean; submitted: boolean;
  onReload: () => void; onBack: () => void; onStatus: () => void; onSubmit: (choice: ServiceApplicationChoice) => void;
  requested?: string; readError?: boolean;
}
export function DriverServiceEnrollmentView(props: EnrollmentViewProps) {
  const { settings, loading, error, busy, submitted, onReload, onBack, onStatus, onSubmit, requested, readError } = props;
  const hasApproval = settings && SERVICES.some(service => settings.services[service].status === 'approved');
  const allowed = settings ? SERVICES.filter(service => canApplyForDriverService(settings, service)) : [];
  return <ApplicationPage title="Service applications" onBack={onBack} busy={busy}>
    {error ? <Feedback error={error} onRetry={onReload} /> : null}
    {!settings ? !error ? <Feedback loading={loading} onRetry={onReload} /> : null : <>
      <Card mint><View style={styles.inline}><RideIcon name="package" size={24} color="primary" /><View style={styles.copy}><Text variant="bodyMedium">{driverVehicleNeedsReview(settings) ? 'Confirm your vehicle type' : hasApproval ? 'Your vehicle, more options' : 'Choose your services'}</Text><Text variant="caption" color="textMuted" style={styles.subtitle}>{driverVehicleNeedsReview(settings) ? 'Staff must review your vehicle type before new jobs.' : hasApproval ? 'Apply using your registered vehicle and documents.' : 'Choose the work you want to provide.'}</Text></View></View></Card>
      {settings.vehicleCategory !== null || driverVehicleNeedsReview(settings) ? <DriverVehicleSummary settings={settings} /> : null}
      <View style={styles.stack}><Heading>Current services</Heading><ServiceApprovalRows settings={settings} hideNone /></View>
      {submitted ? <><Notice icon="check">Your selection was saved. New services require review before requests can be enabled.</Notice><ApplicationAction label="View application status" icon="receipt" onPress={onStatus} disabled={busy} /></> : allowed.length ? <EnrollmentChoices key={settings.version + ':' + (requested ?? 'all')} settings={settings} requested={requested} disabled={busy || loading || readError === true} busy={busy} onSubmit={onSubmit} /> : <Notice>There are no additional services available to apply for right now.</Notice>}
      <ApplicationAction label={hasApproval ? 'Back to dashboard' : 'Back to application status'} outline onPress={onBack} disabled={busy} />
    </>}
  </ApplicationPage>;
}

function EnrollmentChoices({ settings, requested, disabled, busy, onSubmit }: { settings: DriverServiceSettings; requested?: string; disabled: boolean; busy: boolean; onSubmit: (choice: ServiceApplicationChoice) => void }) {
  const { colors } = useTheme();
  const narrow = useWindowDimensions().width < 360;
  const [category, setCategory] = useState(settings.vehicleCategory ?? settings.requestedVehicleCategory ?? null);
  const [services, setServices] = useState<DriverService[]>(() => (requested === 'ride' || requested === 'courier') && canApplyForDriverService(settings, requested) ? [requested] : settings.vehicleCategory === 'motorcycle' && canApplyForDriverService(settings, 'courier') ? ['courier'] : []);
  const [accepted, setAccepted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const choices: { label: string; services: DriverService[]; detail: string; icon: Icon }[] = [
    { label: 'Passenger rides', services: ['ride'], detail: 'Take passengers in your approved car.', icon: 'vehicle' },
    { label: 'Courier deliveries', services: ['courier'], detail: 'Deliver sealed packages up to 5 kg.', icon: 'package' },
    { label: 'Both services', services: ['ride', 'courier'], detail: 'Passenger rides and courier deliveries.', icon: 'swap' },
  ];
  const eligible = choices.filter(choice => choice.services.every(service => canApplyForDriverService(settings, service)) && (category !== 'motorcycle' || !choice.services.includes('ride')));
  const choice: ServiceApplicationChoice | null = category ? { category, services, accepted, consentVersion: settings.consent.version, expectedVersion: settings.version } : null;
  const valid = choice !== null && validServiceApplication(settings, choice);
  const selectCategory = (next: 'car' | 'motorcycle') => {
    if (disabled || (settings.vehicleCategory !== null && settings.vehicleCategory !== next)) return;
    if (next !== category) {
      setCategory(next); setServices(next === 'motorcycle' && canApplyForDriverService(settings, 'courier') ? ['courier'] : []); setAccepted(false); setExpanded(false);
    }
  };
  return <>
    {settings.vehicleCategory === null ? <View style={styles.stack}><Heading>Vehicle type</Heading><View accessibilityRole="radiogroup" accessibilityLabel="Vehicle type" style={styles.vehicleOptions}>{(['car', 'motorcycle'] as const).map(value => {
      const selected = category === value;
      const blocked = disabled || (settings.vehicleCategory !== null && settings.vehicleCategory !== value);
      return <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'car' ? 'Car' : 'Motorcycle'} accessibilityState={{ checked: selected, disabled: blocked }} aria-checked={selected} disabled={blocked} onPress={() => selectCategory(value)} style={[styles.vehicleOption, narrow ? styles.narrowVehicle : null, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, opacity: blocked ? 0.5 : 1 }]}>{narrow ? <><View style={styles.vehicleTop}><VehicleTypeIcon category={value} /><RadioIndicator selected={selected} /></View><Text variant="button">{value === 'car' ? 'Car' : 'Motorcycle'}</Text></> : <><VehicleTypeIcon category={value} /><View style={styles.optionLabel}><Text variant="button">{value === 'car' ? 'Car' : 'Motorcycle'}</Text></View><RadioIndicator selected={selected} /></>}</Pressable>;
    })}</View><Text variant="caption" color="textMuted">One vehicle per account. Motorcycles support courier only.</Text></View> : null}
    {category ? <View style={styles.stack}><Heading>Apply for</Heading><View accessibilityRole="radiogroup" accessibilityLabel="New service selection" style={styles.stack}>{eligible.map(item => {
      const selected = item.services.length === services.length && item.services.every(service => services.includes(service));
      return <Pressable key={item.label} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: selected, disabled: disabled || !category }} aria-checked={selected} disabled={disabled || !category} onPress={() => { if (!disabled && category) { setServices(item.services); setAccepted(false); setExpanded(false); } }} style={[styles.serviceChoice, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, opacity: disabled || !category ? 0.6 : 1 }]}><RideIcon name={item.icon} size={20} color="primary" /><View style={styles.copy}><Text variant="button">{item.label}</Text><Text variant="caption" color="textMuted">{item.detail}</Text></View><RadioIndicator selected={selected} /></Pressable>;
    })}</View><Text variant="caption" color="textMuted">New services require approval. You do not need to register another vehicle or upload the same documents again.</Text></View> : null}
    {category && services.length ? <View style={styles.stack}><View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}><Pressable accessibilityRole="button" accessibilityLabel={services.length === 1 ? (services[0] === 'courier' ? 'Courier service details' : 'Passenger service details') : 'Selected service details'} accessibilityState={{ expanded, disabled }} aria-expanded={expanded} disabled={disabled} onPress={() => setExpanded(value => !value)} style={styles.disclosure}><RideIcon name="receipt" size={18} color="primary" /><View style={styles.copy}><Text variant="button">{services.length === 1 ? services[0] === 'courier' ? 'Courier service details' : 'Passenger service details' : 'Selected service details'}</Text><Text variant="caption" color="textMuted">Read the request requirements.</Text></View><RideIcon name={expanded ? 'minus' : 'down'} size={16} color="icon" /></Pressable>{expanded ? <View style={styles.terms}>{services.map(service => <Text key={service} variant="caption" color="textMuted">{settings.consent.descriptions[service] || 'Service details unavailable. Reload before continuing.'}</Text>)}</View> : null}</View>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Accept service selection consent" accessibilityState={{ checked: accepted, disabled }} aria-checked={accepted} disabled={disabled} onPress={() => { if (!disabled) setAccepted(value => !value); }} style={[styles.consent, { backgroundColor: colors.surfaceMuted, borderColor: accepted ? colors.primary : colors.border }]}><View style={[styles.checkbox, { borderColor: accepted ? colors.primary : colors.borderStrong, backgroundColor: accepted ? colors.primary : colors.surface }]}>{accepted ? <RideIcon name="check" size={14} color="textInverse" /> : null}</View><Text variant="caption" style={styles.copy}>I choose these services and understand the request preferences above.</Text></Pressable>
    </View> : null}
    <View style={styles.stack}><ApplicationAction label="Submit service selection" busy={busy} disabled={disabled || !valid} onPress={() => { if (!disabled && valid && choice) onSubmit(choice); }} /><Text variant="caption" color="textMuted" style={styles.centered}>{!category ? 'Choose a vehicle type to continue.' : !services.length ? 'Choose a service to continue.' : !accepted ? 'Accept the service choice to continue.' : 'Your selection will be reviewed.'}</Text></View>
  </>;
}
function VehicleTypeIcon({ category }: { category: 'car' | 'motorcycle' }) {
  return category === 'car' ? <Image source={require('../../../assets/images/home-v2/ride.png')} contentFit="contain" style={styles.car} accessibilityIgnoresInvertColors /> : <RideIcon name="motorcycle" size={26} color="icon" />;
}
function RadioIndicator({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.borderStrong }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }, circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16, width: '100%', maxWidth: 560, alignSelf: 'center' }, stack: { gap: 10 }, inline: { flexDirection: 'row', alignItems: 'center', gap: 10 }, card: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 12 },
  summary: { borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, subtitle: { marginTop: 4 },
  metadata: { minHeight: 52, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, iconBox: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, serviceRow: { minHeight: 56, paddingVertical: 12, gap: 8 }, badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, maxWidth: '45%', flexShrink: 1 }, reason: { paddingLeft: 40 },
  mintCard: { paddingVertical: 12 }, notice: { padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, action: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, actionText: { textAlign: 'center', flexShrink: 1 }, help: { minHeight: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  feedback: { padding: 16, alignItems: 'center', gap: 10 }, narrowVehicle: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' }, vehicleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, vehicleOptions: { flexDirection: 'row', gap: 10 }, vehicleOption: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, minHeight: 64, padding: 10, gap: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }, optionLabel: { flexGrow: 1, flexBasis: 40, minWidth: 0 }, car: { width: 44, height: 30 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 10, height: 10, borderRadius: 5 },
  serviceChoice: { minHeight: 64, padding: 12, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, disclosure: { minHeight: 54, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, terms: { gap: 10, paddingBottom: 12 }, consent: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, checkbox: { width: 20, height: 20, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }, centered: { textAlign: 'center' },
});
