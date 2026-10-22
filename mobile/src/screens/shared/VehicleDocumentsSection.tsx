import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { useTheme, type AppColors } from '@/constants/theme';
import { useFinanceResource } from '@/hooks/useFinanceResource';
import { getDriverApplicationStatus, type DriverApplicationResponse } from '@/services/driverService';

type IconName = ComponentProps<typeof RideIcon>['name'];
const DOCUMENTS: { kind: DriverApplicationResponse['documents'][number]['kind']; title: string; icon: IconName }[] = [
  { kind: 'license', title: 'Driving licence', icon: 'id-card' },
  { kind: 'registration', title: 'Vehicle registration', icon: 'receipt' },
  { kind: 'insurance', title: 'Insurance', icon: 'safety' },
];
const APPLICATION_STATUS: Record<DriverApplicationResponse['status'], { label: string; color: keyof AppColors; background: keyof AppColors; icon: IconName }> = {
  approved: { label: 'Application approved', color: 'success', background: 'successSoft', icon: 'check' },
  pending: { label: 'Application under review', color: 'warning', background: 'warningSoft', icon: 'clock' },
  rejected: { label: 'Application needs attention', color: 'danger', background: 'dangerSoft', icon: 'receipt' },
  none: { label: 'Application not submitted', color: 'textMuted', background: 'surfaceMuted', icon: 'receipt' },
};

/** Only submitted metadata is read here. Private document paths stay on the API. */
export function VehicleDocumentsSection() {
  const router = useRouter();
  const resource = useFinanceResource(getDriverApplicationStatus);
  return <VehicleDocumentsView data={resource.data} loading={resource.loading} error={resource.error}
    onRetry={() => void resource.refresh()}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')}
    onStatus={() => router.push('/driver-status')}
    onServices={() => router.push('/driver-onboarding')}
    onSupport={() => router.push('/account/support')} />;
}

interface VehicleDocumentsViewProps {
  data: DriverApplicationResponse | null; loading: boolean; error: string | null;
  onRetry: () => void; onBack: () => void; onStatus: () => void; onServices: () => void; onSupport: () => void;
}

export function VehicleDocumentsView({ data, loading, error, onRetry, onBack, onStatus, onServices, onSupport }: VehicleDocumentsViewProps) {
  const { colors } = useTheme();
  const vehicle = data?.vehicle;
  const title = vehicle ? [vehicle.make?.trim(), vehicle.model?.trim()].filter(Boolean).join(' ') || 'Vehicle details unavailable' : 'No vehicle submitted';
  const category = data?.serviceSettings.vehicleCategory;
  const categoryLabel = category === 'car' ? 'Car' : category === 'motorcycle' ? 'Motorcycle' : 'Awaiting classification';
  const status = data ? APPLICATION_STATUS[data.status] : null;
  // Count each expected kind once; a duplicate API row cannot inflate the total.
  const documents = DOCUMENTS.map(document => ({ ...document, available: data?.documents?.some(item => item.kind === document.kind && item.available === true) ?? false }));
  const uploaded = documents.filter(document => document.available).length;

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>Vehicle & documents</Text></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {loading && !data ? <View style={styles.feedback}><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">Loading vehicle and documents…</Text></View> : error || !data ? <View style={[styles.feedback, { backgroundColor: colors.dangerSoft }]}><Text variant="caption" color="danger" accessibilityRole="alert">{error ?? 'Vehicle details are unavailable.'}</Text><Button label="Reload vehicle details" size="sm" onPress={onRetry} /></View> : <>
        {loading ? <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">Refreshing details…</Text> : null}
        <View style={[styles.vehicleCard, { backgroundColor: colors.primarySoft }]}>
          <View style={styles.vehicleHeading}>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.illustration}>
              {vehicle && category !== 'motorcycle' ? <Image source={require('../../../assets/images/home-v2/ride.png')} contentFit="contain" style={styles.car} /> : <RideIcon name={category === 'motorcycle' ? 'motorcycle' : 'vehicle'} size={40} color="primary" />}
            </View>
            <View style={styles.copy}><Text variant="bodyMedium">{title}</Text>{vehicle ? <Text variant="caption" color="textMuted" style={styles.subtitle}>{Number.isInteger(vehicle.year) && (vehicle.year ?? 0) > 0 ? vehicle.year : 'Year unavailable'} · {vehicle.color?.trim() || 'Colour unavailable'}</Text> : null}</View>
          </View>
          <View style={[styles.vehicleDetails, { borderTopColor: colors.border }]}>
            <View style={styles.detail}><Text variant="caption" color="textMuted">Plate number</Text><Text variant="button" selectable>{vehicle?.registrationNumber?.trim() || 'Not available'}</Text></View>
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
            <View style={styles.detail}><Text variant="caption" color="textMuted">Category</Text><Text variant="button">{categoryLabel}</Text></View>
          </View>
          {status ? <View style={[styles.applicationBadge, { backgroundColor: colors[status.background] }]}><RideIcon name={status.icon} size={14} color={status.color} /><Text variant="caption" color={status.color} style={styles.badgeText}>{status.label}</Text></View> : null}
        </View>

        <View style={styles.documentSection}>
          <View style={styles.sectionHeading}><Text variant="button" accessibilityRole="header" style={styles.copy}>Submitted documents</Text><Text variant="caption" color="textMuted">{uploaded} of {DOCUMENTS.length} uploaded</Text></View>
          <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {documents.map((document, index) => <View key={document.kind} style={[styles.documentRow, { borderBottomColor: colors.border, borderBottomWidth: index === documents.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={document.icon} size={18} color="primary" /></View>
              <Text variant="button" style={styles.copy}>{document.title}</Text>
              <View style={[styles.documentBadge, { backgroundColor: document.available ? colors.successSoft : colors.warningSoft }]}><Text variant="caption" color={document.available ? 'success' : 'warning'}>{document.available ? 'Uploaded' : 'Not uploaded'}</Text></View>
            </View>)}
          </View>
          <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="info" size={16} color="textMuted" /><View style={styles.copy}><Text variant="caption" color="textMuted">{uploaded ? 'Uploaded files are on record.' : 'No files uploaded yet.'}</Text><Text variant="caption" color="textMuted">Validity and expiry are not shown here.</Text></View></View>
        </View>

        <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <VehicleLink label="Application status" icon="receipt" onPress={onStatus} />
          <VehicleLink label="Service applications" detail={category === 'motorcycle' ? 'Courier only · Same motorcycle and documents' : 'Ride and courier · Same car and documents'} icon="vehicle" onPress={onServices} last />
        </View>
        <View style={styles.support}><Text variant="button" accessibilityRole="header">Need to replace your vehicle?</Text><Text variant="caption" color="textMuted">One vehicle per account. Contact support to arrange a replacement and review its documents before receiving jobs.</Text><Button label="Contact support" size="sm" fullWidth leftIcon={<RideIcon name="support" size={18} color="textInverse" />} onPress={onSupport} /></View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

function VehicleLink({ label, detail, icon, onPress, last = false }: { label: string; detail?: string; icon: IconName; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} onPress={onPress} style={({ pressed }) => [styles.link, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.iconBox, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={icon} size={18} color="primary" /></View><View style={styles.copy}><Text variant="button">{label}</Text>{detail ? <Text variant="caption" color="textMuted">{detail}</Text> : null}</View><RideIcon name="chevron" size={16} color="icon" />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }, back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 20, width: '100%', maxWidth: 560, alignSelf: 'center' },
  vehicleCard: { padding: 14, borderRadius: 14, gap: 12 }, vehicleHeading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, illustration: { width: 72, height: 50, alignItems: 'center', justifyContent: 'center' }, car: { width: 72, height: 50 }, subtitle: { marginTop: 4 },
  vehicleDetails: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', gap: 14 }, detail: { flex: 1, minWidth: 0, gap: 2 }, detailDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  applicationBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 6, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 }, badgeText: { flexShrink: 1 },
  documentSection: { gap: 10 }, sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 }, group: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  documentRow: { minHeight: 60, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, iconBox: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, documentBadge: { flexShrink: 1, maxWidth: '42%', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 },
  notice: { padding: 12, borderRadius: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, link: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 12, gap: 10 }, support: { gap: 8 }, feedback: { padding: 20, gap: 12, alignItems: 'center', borderRadius: 14 },
});
