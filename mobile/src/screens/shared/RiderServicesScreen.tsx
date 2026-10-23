import { Image, type ImageSource } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, radius, spacing, useTheme, type AppColors } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { roleHome } from '@/utils/roleAccess';

const artwork = {
  ride: require('@/assets/images/home-v2/ride.png'),
  courier: require('@/assets/images/home-v2/courier.png'),
  schedule: require('@/assets/images/home-v2/schedule.png'),
};

export function RiderServicesScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  if (!user) return <Redirect href="/welcome" />;
  if (user.role !== 'rider') return <Redirect href={roleHome(user.role)} />;
  return <RiderServicesView
    onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')}
    onRide={() => router.push('/set-destination')}
    onCourier={() => router.push('/courier')}
    onSchedule={() => router.push('/schedule')}
    onBenefits={() => router.push({ pathname: '/account/[section]', params: { section: 'ride-plus' } })}
  />;
}

interface RiderServicesViewProps {
  onBack: () => void; onRide: () => void; onCourier: () => void;
  onSchedule: () => void; onBenefits: () => void;
}

export function RiderServicesView({ onBack, onRide, onCourier, onSchedule, onBenefits }: RiderServicesViewProps) {
  const { colors } = useTheme();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={19} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header">Our services</Text>
    </View>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text variant="caption" color="textMuted">Choose your next move.</Text>

      <View style={[styles.rideCard, { backgroundColor: colors.primarySoft }]}>
        <View style={styles.rideSummary}>
          <View style={styles.copy}><Text variant="bodyMedium">Ride</Text><Text variant="caption" color="textMuted" style={styles.caption}>Everyday trips across Lagos.</Text></View>
          <Image source={artwork.ride} contentFit="contain" style={styles.car} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </View>
        <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="Book a ride" onPress={onRide} style={({ pressed }) => [styles.rideAction, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
          <View style={styles.arrowSpace} /><Text variant="button" color="textInverse" style={styles.rideLabel}>Book a ride</Text><ActionArrow color="textInverse" />
        </Pressable>
      </View>

      <View style={styles.grid}>
        <ServiceTile title="Courier" description="Send a sealed parcel." action="Send a package" source={artwork.courier} onPress={onCourier} />
        <ServiceTile title="Schedule a ride" description="Plan your pickup time." action="Schedule" source={artwork.schedule} onPress={onSchedule} />
      </View>

      <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel="View Rakky Ride Plus benefits" onPress={onBenefits} style={({ pressed }) => [styles.plusCard, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}>
        <View style={[styles.plusIcon, { backgroundColor: colors.primarySoft }]}><RideIcon name="plus" size={18} color="primary" /></View>
        <View style={styles.copy}><Text variant="button">Rakky Ride Plus</Text><Text variant="caption" color="textMuted" style={styles.caption}>Explore membership benefits.</Text><Text variant="button" color="primary" style={styles.caption}>View benefits</Text></View>
        <RideIcon name="chevron" size={17} color="textMuted" />
      </Pressable>

      <View style={styles.footer}><Text variant="caption" color="textMuted" style={styles.footerText}>Rides and deliveries, in one place.</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

function ServiceTile({ title, description, action, source, onPress }: { title: string; description: string; action: string; source: ImageSource; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={action} onPress={onPress} style={({ pressed }) => [styles.tile, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}>
    <View style={styles.tileBody}><Image source={source} contentFit="contain" style={styles.tileImage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /><Text variant="button">{title}</Text><Text variant="caption" color="textMuted" style={styles.caption}>{description}</Text></View>
    <View style={[styles.tileAction, { borderTopColor: colors.border }]}><Text variant="button" color="primary" style={styles.copy}>{action}</Text><ActionArrow color="primary" /></View>
  </Pressable>;
}

function ActionArrow({ color }: { color: keyof AppColors }) {
  return <View style={styles.arrow}><AddressIcon name="back" size={18} color={color} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, copy: { flex: 1, minWidth: 0 }, caption: { marginTop: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.divider },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, padding: spacing.xl, gap: spacing.md },
  rideCard: { padding: spacing.md, borderRadius: radius.xl, gap: spacing.sm },
  rideSummary: { minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs, gap: spacing.sm },
  car: { width: 80, height: 64 },
  rideAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rideLabel: { flex: 1, textAlign: 'center' }, arrowSpace: { width: 18 }, arrow: { transform: [{ rotate: '180deg' }] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'stretch' },
  tile: { flex: 1, flexBasis: '45%', minWidth: 126, minHeight: 176, borderWidth: borderWidths.divider, borderRadius: radius.xl, overflow: 'hidden' },
  tileBody: { flex: 1, padding: spacing.md }, tileImage: { width: 48, height: 48, marginBottom: spacing.sm },
  tileAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderTopWidth: borderWidths.divider },
  plusCard: { minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: borderWidths.divider, borderRadius: radius.xl },
  plusIcon: { width: 36, height: 36, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  footer: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: spacing['2xl'], paddingBottom: spacing.sm }, footerText: { textAlign: 'center' },
});
