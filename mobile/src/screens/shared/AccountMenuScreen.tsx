import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLogo, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

type MenuItem = { id: string; icon: string; label: string; detail: string };

const ACCOUNT_ITEMS: readonly MenuItem[] = [
  { id: 'profile', icon: '◎', label: 'Profile', detail: 'Personal details and account security' },
];

const SERVICE_ITEMS: readonly MenuItem[] = [
  { id: 'services', icon: '◈', label: 'Services', detail: 'Rides, courier, scheduling, and more' },
];

const SUPPORT_ITEMS: readonly MenuItem[] = [
  { id: 'safety', icon: '◇', label: 'Safety', detail: 'Trusted contacts and protection tools' },
  { id: 'support', icon: '?', label: 'Help & support', detail: 'Get help with your account or a trip' },
  { id: 'settings', icon: '⚙', label: 'Settings', detail: 'Privacy, notifications, and appearance' },
];

const RIDER_ITEMS: readonly MenuItem[] = [
  { id: 'trips', icon: '◷', label: 'Ride history', detail: 'Receipts, completed rides, and active trips' },
  { id: 'payment', icon: '▤', label: 'Payment', detail: 'Cash, cards, and Rakky Ride wallet' },
];

const DRIVER_ITEMS: readonly MenuItem[] = [
  { id: 'driver-wallet', icon: '₦', label: 'Wallet', detail: 'Earnings, balance, rewards, and payouts' },
  { id: 'driver-trips', icon: '◷', label: 'Driver trips', detail: 'Completed trips, fares, and tips' },
  { id: 'vehicle-documents', icon: '🚘', label: 'Vehicle & documents', detail: 'Car, licence, and verification status' },
];

export function AccountMenuScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const setRole = useAuthStore((state) => state.setRole);
  const driverApplication = useAuthStore((state) => state.driverApplication);
  const restartDriverApplication = useAuthStore((state) => state.restartDriverApplication);
  if (!user) return null;
  const driverMode = user.role === 'driver' && driverApplication?.status === 'approved';
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const open = (section: string) => router.push({ pathname: '/account/[section]', params: { section } });
  const close = () => router.canGoBack() ? router.back() : router.replace(driverMode ? '/driver-dashboard' : '/home');
  const switchMode = async () => {
    if (driverMode) { if (await setRole('rider')) router.replace('/home'); }
    else if (driverApplication?.status === 'approved') { if (await setRole('driver')) router.replace('/driver-dashboard'); }
    else if (driverApplication?.status === 'pending' || driverApplication?.status === 'rejected') { router.replace('/driver-status'); }
    else { restartDriverApplication(); router.replace('/driver-onboarding'); }
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

  return <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
    <ScrollView className="flex-1" contentContainerClassName="pb-xl" showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center gap-md px-xl py-sm"><BrandLogo size={64} /><Text variant="bodyMedium">Rakky Ride</Text></View>
      <View className={`mb-sm flex-row items-center px-xl py-md ${driverMode ? 'bg-successSoft' : 'bg-primarySoft'}`}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => open('profile')} className="flex-1 flex-row items-center">
          <View className={`h-12 w-12 items-center justify-center rounded-full ${driverMode ? 'bg-success' : 'bg-primary'}`}><Text variant="bodyMedium" color="textInverse">{initials}</Text></View>
          <View className="ml-sm flex-1"><Text variant="bodyMedium">{user.name}</Text><Text variant="caption" color="textMuted">{user.phone}</Text><View className="flex-row items-center gap-xs"><Text variant="caption" color="warning">★★★★★</Text><Text variant="caption" color="textMuted">5.0 · {driverMode ? 'Driver partner' : 'Rider'}</Text></View></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={close} className="ml-sm h-9 w-9 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="bodyMedium">×</Text></Pressable>
      </View>
      <MenuList items={[...ACCOUNT_ITEMS, ...(driverMode ? DRIVER_ITEMS : RIDER_ITEMS), ...(!driverMode ? SERVICE_ITEMS : []), ...SUPPORT_ITEMS]} onPress={open} />
    </ScrollView>
    <View className="border-t border-border bg-surface px-xl pt-md"><Pressable accessibilityRole="button" onPress={() => void switchMode()} className={`h-14 flex-row items-center justify-center gap-sm rounded-xl ${driverMode ? 'border border-primary' : 'bg-primary'}`}><Text color={driverMode ? 'primary' : 'textInverse'}>{driverMode ? '◉' : '🚘'}</Text><Text variant="button" color={driverMode ? 'primary' : 'textInverse'}>{switchLabel}</Text><Text color={driverMode ? 'primary' : 'textInverse'}>→</Text></Pressable></View>
  </SafeAreaView>;
}

function MenuList({ items, onPress }: { items: readonly MenuItem[]; onPress: (id: string) => void }) {
  return <View className="px-xl">{items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => onPress(item.id)} className="flex-row items-center border-b border-border py-md active:opacity-60"><View className="h-10 w-10 items-center justify-center rounded-lg bg-surfaceMuted"><Text variant="bodyMedium" color={item.id === 'services' || item.id === 'driver-wallet' ? 'success' : 'icon'}>{item.icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{item.label}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{item.detail}</Text></View><Text color="icon">›</Text></Pressable>)}</View>;
}
