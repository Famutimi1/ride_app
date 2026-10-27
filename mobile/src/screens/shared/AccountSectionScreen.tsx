import { feedback } from '@/store/feedbackStore';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { HelpSupportScreen } from './HelpSupportScreen';
import { ProfileScreen } from './ProfileScreen';
import { VehicleDocumentsSection } from './VehicleDocumentsSection';
import { TopUpSection } from './WalletSections';
import { DriverWalletScreen, DriverEarningsScreen, PayoutsScreen } from './DriverFinanceScreens';
import { AddBankScreen, WithdrawScreen } from './PayoutForms';
import { RideHistoryScreen } from './RideHistoryScreen';
import { RiderPaymentScreen } from './RiderPaymentScreen';
import { RiderServicesScreen } from './RiderServicesScreen';
import { SafetyCenterScreen } from './SafetyCenterScreen';
import { SettingsScreen, NotificationSettingsScreen, LocationSettingsScreen, DriverServicesSettingsScreen } from './SettingsScreen';
import { accountSectionRedirect } from '@/utils/roleAccess';

type SectionId = 'profile' | 'services' | 'payment' | 'trips' | 'support' | 'safety' | 'saved-places' | 'settings' | 'notification-settings' | 'location-settings' | 'driver-services' | 'ride-plus' | 'promotions' | 'family' | 'work' | 'earn' | 'driver-wallet' | 'driver-earnings' | 'payouts' | 'driver-trips' | 'vehicle-documents' | 'driver-rewards' | 'top-up' | 'add-bank' | 'withdraw';

const TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  profile: { title: 'Your profile', subtitle: 'Keep your personal details accurate.' },
  services: { title: 'Our services', subtitle: 'Move people and packages across Lagos.' },
  payment: { title: 'Payment', subtitle: 'Choose how you pay for every ride.' },
  trips: { title: 'Trip history', subtitle: 'Your rides, fares, and receipts.' },
  support: { title: 'Help & support', subtitle: 'Tell us what you need help with.' },
  safety: { title: 'Safety center', subtitle: 'Tools that help protect every journey.' },
  'saved-places': { title: 'Saved places', subtitle: 'Book frequent journeys faster.' },
  settings: { title: 'Settings', subtitle: 'Manage your app and privacy preferences.' },
  'location-settings': { title: 'Location permissions', subtitle: 'Manage device location access.' },
  'notification-settings': { title: 'Notifications', subtitle: 'Choose what you receive.' },
  'driver-services': { title: 'Driver services', subtitle: 'Requests, applications and consent.' },
  'ride-plus': { title: 'Rakky Ride Plus', subtitle: 'Save more on the rides you take most.' },
  promotions: { title: 'Promotions', subtitle: 'Apply a code or view active savings.' },
  family: { title: 'Family Profile', subtitle: 'Organise and pay for family travel.' },
  work: { title: 'Work Profile', subtitle: 'Keep business rides and receipts together.' },
  earn: { title: 'Drive with Rakky Ride', subtitle: 'Earn on your own schedule.' },
  'driver-wallet': { title: 'Driver wallet', subtitle: 'Earnings, rewards, balance, and payouts.' },
  'driver-earnings': { title: 'Earnings', subtitle: 'Track income, bonuses, and deductions.' },
  payouts: { title: 'Balance & payouts', subtitle: 'Manage where and when you get paid.' },
  'driver-trips': { title: 'Driver trips', subtitle: 'Trips, earnings, and receipts.' },
  'vehicle-documents': { title: 'Vehicle & documents', subtitle: 'Keep your driver account verified.' },
  'driver-rewards': { title: 'Rewards & goals', subtitle: 'Grow earnings with clear progress.' },
  'top-up': { title: 'Top up', subtitle: 'Add funds securely through Paystack.' },
  'add-bank': { title: 'Add bank account', subtitle: 'Verify your payout details.' },
  withdraw: { title: 'Withdraw earnings', subtitle: 'Move earnings to your bank account.' },
};

export function AccountSectionScreen() {
  const router = useRouter();
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: SectionId = rawSection && rawSection in TITLES ? rawSection as SectionId : 'profile';
  const meta = TITLES[section];
  const user = useAuthStore(state => state.session?.user);
  const userId = user?.id;
  const driverApplication = useAuthStore((state) => state.driverApplication);
  if (!user) return <Redirect href="/welcome" />;
  const redirect = accountSectionRedirect(rawSection ?? '', user.role, driverApplication?.status);
  if (redirect) return <Redirect href={redirect} />;
  if (section === 'vehicle-documents') return <VehicleDocumentsSection key={userId} />;
  if (section === 'driver-trips') return <RideHistoryScreen key={userId} driver />;
  if (section === 'driver-wallet') return <DriverWalletScreen key={userId} />;
  if (section === 'driver-earnings') return <DriverEarningsScreen key={userId} />;
  if (section === 'payouts') return <PayoutsScreen key={userId} />;
  if (section === 'add-bank') return <AddBankScreen key={userId} />;
  if (section === 'withdraw') return <WithdrawScreen key={userId} />;
  if (section === 'profile') return <ProfileScreen />;
  if (section === 'trips') return <RideHistoryScreen />;
  if (section === 'payment') return <RiderPaymentScreen />;
  if (section === 'services') return <RiderServicesScreen />;
  if (section === 'safety') return <SafetyCenterScreen />;
  if (section === 'support') return <HelpSupportScreen />;
  if (section === 'driver-services') return <DriverServicesSettingsScreen />;
  if (section === 'settings') return <SettingsScreen />;
  if (section === 'location-settings') return <LocationSettingsScreen />;
  if (section === 'notification-settings') return <NotificationSettingsScreen />;
  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
    <View className="flex-row items-center border-b border-border px-xl py-md"><Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={() => router.canGoBack() ? router.back() : router.replace('/menu')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable><View className="ml-md flex-1"><Text variant="h3">{meta.title}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{meta.subtitle}</Text></View></View>
    <ScrollView className="flex-1" contentContainerClassName="px-xl py-lg" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><SectionContent section={section} /></ScrollView>
  </SafeAreaView>;
}

function SectionContent({ section }: { section: SectionId }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const setRole = useAuthStore((state) => state.setRole);
  const driverApplication = useAuthStore((state) => state.driverApplication);
  const restartDriverApplication = useAuthStore((state) => state.restartDriverApplication);
  const [email, setEmail] = useState(user?.email ?? '');
  const [code, setCode] = useState('');
  const [joined, setJoined] = useState(false);

  if (section === 'top-up') return <TopUpSection />;
  if (section === 'saved-places') return <><InfoCard icon="⌂" title="Home" detail="12 Road 12, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><InfoCard icon="▣" title="Work" detail="Admiralty Way, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><Button label="Add a saved place" variant="outline" fullWidth className="mt-md" onPress={() => router.push('/set-destination')} /></>;
  if (section === 'ride-plus') return <><FeatureHero icon="✚" title="Your rides, rewarded" detail="Get priority pickup, member-only offers, and 5% ride credit on eligible trips." /><Benefit text="5% credit on eligible rides" /><Benefit text="Priority support when you need help" /><Benefit text="Exclusive airport and weekend offers" /><Button label={joined ? 'Rakky Ride Plus activated' : 'Try Rakky Ride Plus free'} disabled={joined} fullWidth className="mt-xl" onPress={() => setJoined(true)} /></>;
  if (section === 'promotions') return <><Field label="Promo code" value={code} onChangeText={setCode} placeholder="Enter your code" autoCapitalize="characters" /><Button label="Apply code" fullWidth disabled={!code.trim()} onPress={() => { feedback.alert('Promotions', 'Promo codes are not available yet. Please check back later.'); }} /><View className="mt-xl rounded-2xl bg-primarySoft p-lg"><Text variant="caption" color="primary">ACTIVE OFFER</Text><Text variant="h3" className="mt-xs">10% launch discount</Text><Text variant="caption" color="textMuted" className="mt-xs">Automatically applied to eligible rides for a limited time.</Text></View></>;
  if (section === 'family') return <><FeatureHero icon="⌂" title="Travel together, pay once" detail="Invite family members, choose spending limits, and receive every trip receipt." /><Field label="Family member’s phone" value={code} onChangeText={setCode} placeholder="+234" keyboardType="phone-pad" /><Button label="Send invitation" fullWidth disabled={!code.trim()} onPress={() => { feedback.alert('Family profiles', 'Family invitations are not available yet. Please check back later.'); }} /></>;
  if (section === 'work') return <><FeatureHero icon="▣" title="Separate work from personal" detail="Use a business payment method and receive organised monthly ride statements." /><Field label="Work email" value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" /><Button label="Create Work Profile" fullWidth disabled={!email.trim()} onPress={() => feedback.alert('Work profiles', 'Work profiles are not available yet. Please check back later.')} /></>;
  if (section === 'driver-rewards') return <><FeatureHero icon="★" title="8 of 12 trips completed" detail="Complete 4 more eligible trips by Sunday to earn a ₦5,000 bonus." /><View className="h-3 overflow-hidden rounded-full bg-surfaceMuted"><View className="h-full w-2/3 rounded-full bg-success" /></View><Text variant="caption" color="textMuted" className="mt-sm">67% complete · Lagos weekly challenge</Text><Text variant="bodyMedium" className="mb-sm mt-xl">Available campaigns</Text><InfoCard icon="↗" title="Friday evening boost" detail="Earn 15% more · 5 PM–10 PM" action="Details" onPress={() => feedback.alert('Friday boost', 'Eligible trips starting in Lagos between 5 PM and 10 PM receive the boost.')} /><InfoCard icon="⌖" title="Airport pickup reward" detail="Complete 3 airport pickups · ₦3,000" action="Track" onPress={() => feedback.alert('Airport reward', 'You have completed 1 of 3 eligible airport pickups.')} /></>;
  return <><FeatureHero icon="🚘" title="Drive when it works for you" detail="Go online, receive nearby requests, track earnings, and get paid securely." /><Benefit text="Choose your own driving hours" /><Benefit text="See trip destination and fare clearly" /><Benefit text="Safety support while you’re online" /><Button label={driverApplication?.status === 'approved' ? 'Switch to driver mode' : driverApplication?.status === 'pending' ? 'View application status' : driverApplication?.status === 'rejected' ? 'Review application' : 'Apply to drive'} fullWidth className="mt-xl" onPress={() => { if (driverApplication?.status === 'approved') { void setRole('driver').then((changed) => changed && router.replace('/driver-dashboard')); return; } if (driverApplication?.status === 'pending' || driverApplication?.status === 'rejected') { router.replace('/driver-status'); return; } restartDriverApplication(); router.replace('/driver-onboarding'); }} /></>;
}

function Field(props: ComponentProps<typeof TextInput> & { label: string }) { const theme = useTheme(); const { label, ...inputProps } = props; return <View className="mb-md"><Text variant="caption" color="textMuted" className="mb-xs">{label}</Text><TextInput selectionColor={theme.colors.primary} placeholderTextColor={theme.colors.textMuted} className="min-h-12 rounded-lg border border-borderStrong bg-surface px-md py-md font-inter-regular text-body text-text outline-none" {...inputProps} /></View>; }
function InfoCard({ icon, title, detail, action, onPress }: { icon: string; title: string; detail: string; action: string; onPress?: () => void }) { return <Pressable onPress={onPress} className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color="icon">{icon}</Text></View><View className="ml-md flex-1 pr-sm"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Text variant="caption" color="primary" className="ml-sm shrink-0">{action}</Text></Pressable>; }
function FeatureHero({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <View className="mb-lg rounded-2xl bg-primarySoft p-lg"><View className="h-12 w-12 items-center justify-center rounded-xl bg-primary"><Text color="textInverse">{icon}</Text></View><Text variant="h3" className="mt-md">{title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{detail}</Text></View>; }
function Benefit({ text }: { text: string }) { return <View className="flex-row items-center gap-md border-b border-border py-md"><View className="h-7 w-7 items-center justify-center rounded-full bg-successSoft"><Text color="success">✓</Text></View><Text variant="bodyMedium" className="flex-1">{text}</Text></View>; }
