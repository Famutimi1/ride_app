import { useEffect, useRef } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidths, nativeWindTheme, radius, spacing, useTheme } from '@/constants/theme';
import type { DriverService, DriverServiceSettings } from '@/services/driverService';
import { canApplyForDriverService, driverServiceAvailable, driverServiceEnabled, driverServiceStatus, driverVehicleServices, driverVehicleNeedsReview } from '@/utils/driverServices';
import { DriverVehicleSummary } from './DriverVehicleSummary';
import { Button } from './Button';
import { Text } from './Text';
import { RideIcon } from './RideIcon';

export interface DriverServicesViewProps {
  compact: boolean; settings: DriverServiceSettings | null; saving: boolean; refreshing: boolean; error: string | null; notice: string; expanded: boolean; withdrawing: DriverService | null;
  onManage: () => void; onToggle: (service: DriverService) => void; onReload: () => void; onApplications: (service?: DriverService) => void;
  onWithdrawStart: (service: DriverService) => void; onWithdrawCancel: () => void; onWithdrawConfirm: () => void;
}

export function DriverServicesView(props: DriverServicesViewProps) {
  const { colors, scheme } = useTheme();
  const closeRef = useRef<View>(null);
  const manageRef = useRef<View>(null);
  const lastWithdrawal = useRef<DriverService | null>(null);
  const withdrawRefs = useRef<Record<DriverService, View | null>>({ ride: null, courier: null });
  const registerWithdrawRef = (service: DriverService, node: View | null) => { withdrawRefs.current[service] = node; };
  const { compact, expanded, withdrawing, saving, refreshing, onManage, onWithdrawCancel } = props;
  const busy = saving || refreshing;
  useEffect(() => { if (withdrawing) lastWithdrawal.current = withdrawing; }, [withdrawing]);
  const close = () => { if (!busy) onManage(); };
  const keep = () => {
    if (busy) return;
    onWithdrawCancel();
    if (compact && Platform.OS === 'web') requestAnimationFrame(() => closeRef.current?.focus());
  };
  const confirmation = withdrawing ? <ConsentConfirmation service={withdrawing} busy={saving} error={props.error} onKeep={keep} onConfirm={props.onWithdrawConfirm} /> : null;
  return <View className={compact ? 'mt-sm' : ''}>
    {compact ? <>
      <View style={styles.heading}><Text variant="button" accessibilityRole="header" style={styles.copy}>Your services</Text><Pressable ref={manageRef} accessibilityRole="button" accessibilityLabel="Manage services" accessibilityState={{ expanded, disabled: busy }} aria-expanded={expanded} disabled={busy} onPress={onManage} style={styles.textAction}><Text variant="caption" color="primary">Manage</Text><RideIcon name="chevron" size={16} color="primary" /></Pressable></View>
      <ServiceSummary {...props} />
    </> : <ManagementContent {...props} registerWithdrawRef={registerWithdrawRef} />}
    <Modal visible={compact ? expanded : withdrawing !== null} transparent animationType="fade" onDismiss={() => { if (Platform.OS === 'web') requestAnimationFrame(() => { if (compact) manageRef.current?.focus(); else if (lastWithdrawal.current) withdrawRefs.current[lastWithdrawal.current]?.focus(); }); }} onShow={() => { if (compact && !withdrawing && Platform.OS === 'web') closeRef.current?.focus(); }} onRequestClose={withdrawing ? keep : close} accessibilityLabel={withdrawing ? 'Withdraw service consent' : 'Manage services'}>
      <View style={[nativeWindTheme[scheme], styles.modalRoot, { backgroundColor: colors.overlay }]}>
        {compact ? <>
          <Pressable accessible={false} onPress={withdrawing ? keep : close} disabled={busy} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={['bottom']} accessibilityViewIsModal={!withdrawing} accessibilityElementsHidden={Boolean(withdrawing)} importantForAccessibility={withdrawing ? 'no-hide-descendants' : 'auto'} aria-hidden={Boolean(withdrawing)} pointerEvents={withdrawing ? 'none' : 'auto'} style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /></View>
            <View style={styles.sheetHeading}><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>Manage services</Text><Pressable ref={closeRef} accessibilityRole="button" accessibilityLabel="Close Manage services" accessibilityState={{ disabled: busy }} disabled={busy} onPress={close} style={[styles.close, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="close" size={18} /></Pressable></View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}><ManagementContent {...props} registerWithdrawRef={registerWithdrawRef} /></ScrollView>
          </SafeAreaView>
          {confirmation ? <View style={[styles.confirmLayer, { backgroundColor: colors.overlay }]}>{confirmation}</View> : null}
        </> : <View style={styles.confirmLayer}>{confirmation}</View>}
      </View>
    </Modal>
  </View>;
}

function ServiceSummary(props: DriverServicesViewProps) {
  const { colors } = useTheme();
  const { settings, saving, refreshing, error, notice, onToggle } = props;
  if (!settings) return <LoadStatus {...props} />;
  return <>
    <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {driverVehicleServices(settings.vehicleCategory).map((service, index, services) => {
        const state = settings.services[service];
        const available = driverServiceAvailable(settings, service);
        return <View key={service} style={[styles.summaryRow, { borderBottomColor: colors.border, borderBottomWidth: index < services.length - 1 ? borderWidths.divider : 0 }]}>
          <ServiceIcon service={service} available={available} />
          <View style={styles.copy}><Text variant="caption">{service === 'ride' ? 'Passenger rides' : 'Courier deliveries'}</Text><Text variant="caption" color={state.status === 'rejected' || state.status === 'suspended' ? 'danger' : available ? 'success' : 'textMuted'}>{driverServiceStatus(state)}{state.status === 'none' ? ' · Apply in Manage' : ` · Requests ${driverServiceEnabled(settings, service) ? 'on' : 'off'}`}</Text></View>
          <ServiceSwitch label={service === 'ride' ? 'Receive passenger ride requests' : 'Receive courier requests'} value={driverServiceEnabled(settings, service)} disabled={saving || refreshing || !available} onChange={() => onToggle(service)} />
        </View>;
      })}
    </View>
    {notice && !props.expanded ? <Text variant="caption" color="success" accessibilityLiveRegion="polite" style={styles.gap}>{notice}</Text> : null}
    {error && !props.expanded ? <ErrorStatus {...props} /> : null}
  </>;
}

function ManagementContent(props: DriverServicesViewProps & { registerWithdrawRef?: (service: DriverService, node: View | null) => void }) {
  const { colors } = useTheme();
  const { settings, saving, refreshing, notice, error, onApplications } = props;
  const canApplyCourier = settings && canApplyForDriverService(settings, 'courier');
  const courierStatus = settings?.services.courier.status;
  const applicationLabel = canApplyCourier ? courierStatus === 'approved' ? 'Review courier consent' : courierStatus === 'pending' ? 'Complete courier application' : 'Apply for courier' : 'Manage applications';
  const busy = saving || refreshing;
  return <View>
    <Text variant="caption" color="textMuted" style={styles.subtitle}>Choose which new requests you receive.</Text>
    {settings ? <View style={styles.cards}><DriverVehicleSummary settings={settings} />{driverVehicleServices(settings.vehicleCategory).map(service => <ManagementCard key={service} service={service} {...props} />)}</View> : <LoadStatus {...props} />}
    <View style={styles.info}><RideIcon name="safety" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Changes affect new requests. Complete accepted jobs.</Text></View>
    {saving ? <View accessibilityLiveRegion="polite" style={styles.info}><ActivityIndicator size="small" color={colors.primary} /><Text variant="caption" color="textMuted">Saving changes…</Text></View> : notice ? <Text variant="caption" color="success" accessibilityLiveRegion="polite" style={styles.gap}>{notice}</Text> : !error && settings ? <Text variant="caption" color="textMuted" style={styles.gap}>Request preferences save automatically.</Text> : null}
    {error && settings ? <ErrorStatus {...props} /> : null}
    <Button label={applicationLabel} size="sm" fullWidth className="mt-lg" disabled={busy || !settings} leftIcon={<RideIcon name={canApplyCourier ? 'package' : 'receipt'} size={16} color="textInverse" />} onPress={() => onApplications(canApplyCourier ? 'courier' : undefined)} />
    <Button label="Refresh status" accessibilityLabel="Refresh service status" size="sm" variant="outline" fullWidth className="mt-sm" loading={refreshing} disabled={saving} leftIcon={<RideIcon name="refresh" size={16} color="primary" />} onPress={props.onReload} />
  </View>;
}

function ManagementCard({ service, ...props }: DriverServicesViewProps & { service: DriverService; registerWithdrawRef?: (service: DriverService, node: View | null) => void }) {
  const { colors } = useTheme();
  const state = props.settings!.services[service];
  const available = driverServiceAvailable(props.settings!, service);
  const danger = state.status === 'suspended' || state.status === 'rejected';
  const helper = driverVehicleNeedsReview(props.settings!) ? 'Vehicle review is required before new requests.' : state.status === 'none' ? service === 'ride' ? 'Apply to start passenger rides.' : 'Apply to start courier deliveries.' : state.status === 'pending' ? 'We’ll update this status after review.' : state.status === 'suspended' ? 'Requests are blocked until staff restore this service.' : state.status === 'rejected' ? 'Review the decision before applying again.' : !state.consentAccepted ? 'Accept service consent in Applications to receive requests.' : service === 'ride' ? 'New passenger ride requests.' : 'New courier delivery requests.';
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.cardHeading}><ServiceIcon service={service} available={available} /><Text variant="button" style={styles.copy}>{service === 'ride' ? 'Passenger rides' : 'Courier deliveries'}</Text><View style={[styles.badge, { backgroundColor: danger ? colors.dangerSoft : available ? colors.successSoft : colors.surfaceMuted }]}><Text variant="caption" color={danger ? 'danger' : available ? 'success' : 'textMuted'}>{driverServiceStatus(state)}</Text></View></View>
    <View style={styles.requestRow}><Text variant="caption" style={styles.copy}>Receive requests</Text><ServiceSwitch label={service === 'ride' ? 'Receive passenger ride requests' : 'Receive courier requests'} value={driverServiceEnabled(props.settings!, service)} disabled={props.saving || props.refreshing || !available} onChange={() => props.onToggle(service)} /></View>
    <Text variant="caption" color="textMuted">{helper}</Text>
    {state.review?.reason ? <Text variant="caption" color="textMuted" style={styles.gap}>Review reason: {state.review.reason}</Text> : null}
    {state.consentAccepted ? <View style={[styles.consentRow, { borderTopColor: colors.border }]}><RideIcon name="safety" size={16} color="textMuted" /><Text variant="caption" style={styles.copy}>Consent accepted</Text><Pressable ref={node => props.registerWithdrawRef?.(service, node)} accessibilityRole="button" accessibilityLabel={`Withdraw ${service === 'ride' ? 'passenger' : 'courier'} consent`} disabled={props.saving || props.refreshing} accessibilityState={{ disabled: props.saving || props.refreshing }} onPress={() => props.onWithdrawStart(service)} style={styles.textAction}><Text variant="caption" color="danger">Withdraw</Text><RideIcon name="chevron" size={16} color="danger" /></Pressable></View> : null}
  </View>;
}

function ConsentConfirmation({ service, busy, error, onKeep, onConfirm }: { service: DriverService; busy: boolean; error: string | null; onKeep: () => void; onConfirm: () => void }) {
  const { colors } = useTheme();
  const keepRef = useRef<View>(null);
  useEffect(() => { if (Platform.OS === 'web') keepRef.current?.focus(); }, []);
  return <View accessibilityViewIsModal accessibilityLabel="Confirm consent withdrawal" style={[styles.dialog, { backgroundColor: colors.surface }]}>
    <ScrollView contentContainerStyle={styles.dialogContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.warningIcon, { backgroundColor: colors.dangerSoft }]}><RideIcon name="safety" size={20} color="danger" /></View>
      <Text variant="bodyMedium" accessibilityRole="header" style={styles.center}>Withdraw {service === 'ride' ? 'passenger' : 'courier'} consent?</Text>
      <Text variant="caption" color="textMuted" style={[styles.center, styles.gap]}>{service === 'ride' ? 'Passenger' : 'Courier'} requests will stop. To return, select this service and accept consent in Applications.</Text>
      <View style={styles.info}><RideIcon name="safety" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Accepted jobs must still be completed.</Text></View>
      {error ? <Text variant="caption" color="danger" accessibilityRole="alert" style={styles.gap}>{error}</Text> : null}
      <Pressable ref={keepRef} accessibilityRole="button" accessibilityLabel="Keep consent" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onKeep} style={[styles.confirmButton, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}><Text variant="button" color="textInverse">Keep consent</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Withdraw consent" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={onConfirm} style={[styles.withdrawButton, { borderColor: colors.danger, opacity: busy ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={colors.danger} size="small" /> : null}<Text variant="button" color="danger">{busy ? 'Withdrawing…' : 'Withdraw consent'}</Text></Pressable>
    </ScrollView>
  </View>;
}

function LoadStatus(props: DriverServicesViewProps) {
  const { colors } = useTheme();
  return props.error ? <ErrorStatus {...props} /> : <View style={styles.info}><ActivityIndicator size="small" color={colors.primary} /><Text variant="caption" color="textMuted">Loading services…</Text></View>;
}
function ErrorStatus({ error, saving, refreshing, onReload }: DriverServicesViewProps) {
  return <View style={styles.gap}><Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text><Button label="Reload services" variant="ghost" size="sm" disabled={saving || refreshing} onPress={onReload} /></View>;
}
function ServiceIcon({ service, available }: { service: DriverService; available: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.icon, { backgroundColor: available ? colors.primarySoft : colors.surfaceMuted }]}><RideIcon name={service === 'ride' ? 'vehicle' : 'package'} size={18} color={available ? 'primary' : 'textMuted'} /></View>;
}
function ServiceSwitch({ label, value, disabled, onChange }: { label: string; value: boolean; disabled: boolean; onChange: () => void }) {
  const { colors } = useTheme();
  if (Platform.OS === 'web') return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} aria-checked={value} disabled={disabled} onPress={onChange} style={[styles.switchTarget, { opacity: disabled ? 0.5 : 1 }]}><View style={[styles.track, { backgroundColor: value ? colors.primary : colors.borderStrong, alignItems: value ? 'flex-end' : 'flex-start' }]}><View style={[styles.thumb, { backgroundColor: value ? colors.textInverse : colors.surface }]} /></View></Pressable>;
  return <View style={styles.switchTarget}><Switch accessibilityLabel={label} value={value} disabled={disabled} hitSlop={8} onValueChange={onChange} trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={value ? colors.textInverse : colors.surface} /></View>;
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  group: { borderWidth: 1, borderRadius: radius.xl, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg },
  switchTarget: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  track: { width: 40, height: 24, padding: 3, borderRadius: radius.full, justifyContent: 'center' }, thumb: { width: 18, height: 18, borderRadius: radius.full },
  gap: { marginTop: spacing.sm }, subtitle: { marginBottom: spacing.md }, cards: { gap: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.xl, padding: spacing.md }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, maxWidth: '40%' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  consentRow: { marginTop: spacing.md, paddingTop: spacing.xs, borderTopWidth: borderWidths.divider, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  modalRoot: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  close: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  handleArea: { paddingVertical: spacing.sm, alignItems: 'center' }, handle: { width: 36, height: 4, borderRadius: radius.full },
  scroll: { flexShrink: 1 }, sheetContent: { padding: spacing.lg, paddingTop: spacing.sm },
  confirmLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  dialog: { width: '100%', maxWidth: 400, maxHeight: '90%', borderRadius: radius.xl, overflow: 'hidden' },
  dialogContent: { padding: spacing.lg }, center: { textAlign: 'center' },
  warningIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, alignSelf: 'center', marginBottom: spacing.md },
  confirmButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  withdrawButton: { minHeight: 44, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
});
