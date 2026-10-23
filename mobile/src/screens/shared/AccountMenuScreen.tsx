import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, BrandLogo, Text } from '@/components/common';
import { borderWidths, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';

import { AccountMenuIcon, type MenuIconName } from './AccountMenuIcon';

type MenuItem = { id: string; icon: MenuIconName; label: string };

const RIDER_ITEMS: readonly MenuItem[] = [
  { id: 'trips', icon: 'history', label: 'Ride history' },
  { id: 'payment', icon: 'payment', label: 'Payment' },
  { id: 'services', icon: 'services', label: 'Services' },
];

const DRIVER_ITEMS: readonly MenuItem[] = [
  { id: 'driver-wallet', icon: 'wallet', label: 'Wallet' },
  { id: 'driver-trips', icon: 'history', label: 'Driver trips' },
  { id: 'vehicle-documents', icon: 'documents', label: 'Vehicle & documents' },
];

const SUPPORT_ITEMS: readonly MenuItem[] = [
  { id: 'notification-center', icon: 'notifications', label: 'Notifications' },
  { id: 'safety', icon: 'safety', label: 'Safety' },
  { id: 'support', icon: 'support', label: 'Help & support' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
];

export function AccountMenuScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.session?.user);
  const setRole = useAuthStore(state => state.setRole);
  const driverApplication = useAuthStore(state => state.driverApplication);
  const restartDriverApplication = useAuthStore(state => state.restartDriverApplication);
  const [switching, setSwitching] = useState(false);
  if (!user) return null;

  const driverMode = user.role === 'driver' && driverApplication?.status === 'approved';
  const open = (section: string) => section === 'notification-center'
    ? router.push('/notification-center')
    : router.push({ pathname: '/account/[section]', params: { section } });
  const close = () => router.canGoBack() ? router.back() : router.replace(driverMode ? '/driver-dashboard' : '/home');
  const switchMode = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      if (driverMode) {
        if (await setRole('rider')) router.replace('/home');
      } else if (driverApplication?.status === 'approved') {
        if (await setRole('driver')) router.replace('/driver-dashboard');
      } else if (driverApplication?.status === 'pending' || driverApplication?.status === 'rejected') {
        router.replace('/driver-status');
      } else {
        restartDriverApplication();
        router.replace('/driver-onboarding');
      }
    } finally {
      setSwitching(false);
    }
  };
  const switchLabel = driverMode
    ? 'Switch to rider mode'
    : driverApplication?.status === 'approved'
      ? 'Switch to driver mode'
      : driverApplication?.status === 'pending'
        ? 'View driver application'
        : driverApplication?.status === 'rejected'
          ? 'Review driver application'
          : 'Apply to drive';
  const bannerTitle = driverMode ? 'Ride with Rakky'
    : driverApplication?.status === 'approved' ? 'Ready to drive?'
      : driverApplication?.status === 'pending' || driverApplication?.status === 'rejected' ? 'Your application'
        : 'Drive with Rakky';

  return <AccountMenuView name={user.name} avatarUrl={user.avatarUrl} driverMode={driverMode} switchLabel={switchLabel} bannerTitle={bannerTitle} switching={switching} onOpen={open} onClose={close} onSwitch={() => void switchMode()} />;
}

interface AccountMenuViewProps {
  name: string;
  avatarUrl?: string | null;
  driverMode: boolean;
  switchLabel: string;
  bannerTitle: string;
  switching: boolean;
  onOpen: (section: string) => void;
  onClose: () => void;
  onSwitch: () => void;
}

/** Shared rider/driver menu layout, with navigation kept in the screen controller. */
export function AccountMenuView({ name, avatarUrl, driverMode, switchLabel, bannerTitle, switching, onOpen, onClose, onSwitch }: AccountMenuViewProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.frame}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <BrandLogo size={32} />
            <Text variant="bodyMedium" numberOfLines={1}>RAKKY <Text variant="bodyMedium" color="primary">RIDE</Text></Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={[styles.close, { backgroundColor: colors.surfaceMuted }]}>
            <AccountMenuIcon name="close" size={20} />
          </Pressable>
        </View>

        <ScrollView style={styles.screen} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => onOpen('profile')} style={[styles.profile, { borderBottomColor: colors.border }]}>
            <Avatar uri={avatarUrl} name={name} size="lg" />
            <View style={styles.profileCopy}>
              <Text variant="bodyMedium" numberOfLines={1}>{name}</Text>
              <Text variant="caption" color="textMuted">{driverMode ? 'Driver partner' : 'Rider'}</Text>
            </View>
            <Text variant="caption" color="primary">View profile →</Text>
          </Pressable>

          <MenuList items={driverMode ? DRIVER_ITEMS : RIDER_ITEMS} onPress={onOpen} />
          <View style={[styles.groupSeparator, { backgroundColor: colors.border }]} />
          <MenuList items={SUPPORT_ITEMS} onPress={onOpen} />
        </ScrollView>

        <View style={styles.footer}>
          <Pressable cssInterop={false} accessibilityRole="button" accessibilityLabel={switchLabel} accessibilityState={{ disabled: switching, busy: switching }} disabled={switching} onPress={onSwitch}
            style={({ pressed }) => [styles.driverBanner, { backgroundColor: colors.primarySoft, opacity: pressed || switching ? 0.7 : 1 }]}
          >
            <View style={styles.bannerCopy}>
              <Text variant="bodyMedium">{bannerTitle}</Text>
              <Text variant="button" color="primary">{switching ? 'Switching mode…' : `${switchLabel} →`}</Text>
            </View>
            {switching ? <ActivityIndicator color={colors.primary} style={styles.car} /> : (
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
                <Image source={require('@/assets/images/register-v1/car.png')} contentFit="cover" style={styles.car} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function MenuList({ items, onPress }: { items: readonly MenuItem[]; onPress: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <View>
      {items.map((item, index) => (
        <Pressable cssInterop={false} key={item.id} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => onPress(item.id)}
          style={({ pressed }) => [styles.menuRow, { borderBottomColor: colors.border, borderBottomWidth: index < items.length - 1 ? borderWidths.divider : 0, opacity: pressed ? 0.6 : 1 }]}
        >
          <AccountMenuIcon name={item.icon} />
          <Text variant="bodyMedium" style={styles.menuLabel}>{item.label}</Text>
          <AccountMenuIcon name="chevron" size={18} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  frame: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  header: { minHeight: 56, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 24, paddingBottom: 12 },
  profile: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg, borderBottomWidth: borderWidths.divider },
  profileCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  menuRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 15 },
  menuLabel: { flex: 1 },
  groupSeparator: { height: borderWidths.divider },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  driverBanner: { minHeight: 96, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerCopy: { flex: 1, gap: 8 },
  car: { width: 96, height: 76 },
});
