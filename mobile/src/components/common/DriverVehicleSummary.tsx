import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/constants/theme';
import type { DriverServiceSettings } from '@/services/driverService';
import { driverVehicleNeedsReview } from '@/utils/driverServices';
import { RideIcon } from './RideIcon';
import { Text } from './Text';

/** All service applications refer to this account's single registered vehicle. */
export function DriverVehicleSummary({ settings }: { settings: DriverServiceSettings }) {
  const { colors } = useTheme();
  const router = useRouter();
  const vehicle = settings.vehicle;
  const label = settings.vehicleCategory === 'car' ? 'Car' : settings.vehicleCategory === 'motorcycle' ? 'Motorcycle' : 'Vehicle type awaiting review';
  const name = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ');
  return <View style={[styles.card, { backgroundColor: colors.surfaceMuted }]}>
    <RideIcon name={settings.vehicleCategory === 'motorcycle' ? 'motorcycle' : 'vehicle'} size={24} color="primary" />
    <View style={styles.copy}>
      <Text variant="button">{name || label}{vehicle?.registrationNumber ? ` · ${vehicle.registrationNumber}` : ''}</Text>
      <Text variant="caption" color="textMuted">{driverVehicleNeedsReview(settings) ? 'Vehicle review is required before receiving new jobs.' : settings.vehicleCategory === 'motorcycle' ? 'One motorcycle · Courier only' : settings.vehicleCategory === 'car' ? 'One car · Eligible for rides and courier' : 'Choose the type of your existing vehicle.'}</Text>
      <Text variant="caption" color="textMuted">New services use this vehicle and its documents. Replacements require support review.</Text>
      {driverVehicleNeedsReview(settings) ? <Pressable accessibilityRole="button" accessibilityLabel="Contact support about vehicle review" onPress={() => router.push('/account/support')} style={styles.action}><Text variant="button" color="primary">Contact support →</Text></Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
