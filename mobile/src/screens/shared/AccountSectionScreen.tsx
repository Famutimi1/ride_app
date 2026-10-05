import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { ThemePreferencePicker } from '@/components/common/ThemePreferencePicker';
import { useAuthStore } from '@/store/authStore';
import { getTripHistory, type Trip } from '@/services/tripService';
import { AddBankSection, DriverEarningsSection, DriverWalletSection, PayoutsSection, RiderWalletSection, TopUpSection, WithdrawSection } from './WalletSections';

type SectionId = 'profile' | 'services' | 'payment' | 'trips' | 'support' | 'safety' | 'saved-places' | 'settings' | 'ride-plus' | 'promotions' | 'family' | 'work' | 'earn' | 'driver-wallet' | 'driver-earnings' | 'payouts' | 'driver-trips' | 'vehicle-documents' | 'driver-rewards' | 'top-up' | 'add-bank' | 'withdraw';

const DRIVER_ONLY_SECTIONS = new Set<SectionId>(['driver-wallet', 'driver-earnings', 'payouts', 'driver-trips', 'vehicle-documents', 'driver-rewards', 'add-bank', 'withdraw']);

const TITLES: Record<SectionId, { title: string; subtitle: string }> = {
  profile: { title: 'Your profile', subtitle: 'Keep your personal details accurate.' },
  services: { title: 'Our services', subtitle: 'Move people and packages across Lagos.' },
  payment: { title: 'Payment', subtitle: 'Choose how you pay for every ride.' },
  trips: { title: 'Trip history', subtitle: 'Your rides, fares, and receipts.' },
  support: { title: 'Help & support', subtitle: 'Tell us what you need help with.' },
  safety: { title: 'Safety center', subtitle: 'Tools that help protect every journey.' },
  'saved-places': { title: 'Saved places', subtitle: 'Book frequent journeys faster.' },
  settings: { title: 'Settings', subtitle: 'Manage your app and privacy preferences.' },
  'ride-plus': { title: 'Rakky Ride Plus', subtitle: 'Save more on the rides you take most.' },
  promotions: { title: 'Promotions', subtitle: 'Apply a code or view active savings.' },
  family: { title: 'Family Profile', subtitle: 'Organise and pay for family travel.' },
  work: { title: 'Work Profile', subtitle: 'Keep business rides and receipts together.' },
  earn: { title: 'Drive with Rakky Ride', subtitle: 'Earn on your own schedule.' },
  'driver-wallet': { title: 'Driver wallet', subtitle: 'Earnings, rewards, balance, and payouts.' },
  'driver-earnings': { title: 'Earnings', subtitle: 'Track income, bonuses, and deductions.' },
  payouts: { title: 'Balance & payouts', subtitle: 'Manage where and when you get paid.' },
  'driver-trips': { title: 'Driver trips', subtitle: 'Completed trips, fares, and tips.' },
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
  const driverApplication = useAuthStore((state) => state.driverApplication);
  if (DRIVER_ONLY_SECTIONS.has(section) && driverApplication?.status !== 'approved') {
    return <Redirect href={driverApplication?.status === 'pending' || driverApplication?.status === 'rejected' ? '/driver-status' : '/driver-onboarding'} />;
  }
  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
    <View className="flex-row items-center border-b border-border px-xl py-md"><Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={() => router.canGoBack() ? router.back() : router.replace('/menu')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable><View className="ml-md flex-1"><Text variant="h3" className="!text-[21px]">{meta.title}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{meta.subtitle}</Text></View></View>
    <ScrollView className="flex-1" contentContainerClassName="px-xl py-lg" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><SectionContent section={section} /></ScrollView>
  </SafeAreaView>;
}

function SectionContent({ section }: { section: SectionId }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const setRole = useAuthStore((state) => state.setRole);
  const driverApplication = useAuthStore((state) => state.driverApplication);
  const restartDriverApplication = useAuthStore((state) => state.restartDriverApplication);
  const logout = useAuthStore((state) => state.logout);
  const [name, setName] = useState(user?.name ?? 'Rider');
  const [email, setEmail] = useState(user?.email ?? '');
  const [code, setCode] = useState('');
  const [trusted, setTrusted] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [joined, setJoined] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState<string | null>(null);
  useEffect(() => {
    if (section !== 'trips' && section !== 'driver-trips') return;
    void getTripHistory().then((result) => setTrips(result.trips)).catch(() => setTripsError('Could not load your trip history.')).finally(() => setTripsLoading(false));
  }, [section]);

  const confirmAccountDeletion = () => {
    Alert.alert(
      'Delete your account?',
      'Your profile and saved account information will be removed. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/welcome');
          },
        },
      ],
    );
  };

  if (section === 'profile') return <><AvatarLetter value={name} /><Field label="Full name" value={name} onChangeText={setName} /><Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" /><Field label="Phone number" value={user?.phone ?? ''} editable={false} />{user?.role !== 'driver' ? <InfoCard icon="🚘" title="Drive with Rakky Ride" detail={driverApplication?.status === 'approved' ? 'Your driver account is approved and ready' : driverApplication?.status === 'pending' ? 'Your driver application is being reviewed' : driverApplication?.status === 'rejected' ? 'Review the decision and update your application' : 'Register your vehicle and receive nearby requests'} action={driverApplication?.status === 'approved' ? 'Switch' : driverApplication ? 'View' : 'Apply'} onPress={() => { if (driverApplication?.status === 'approved') { void setRole('driver').then((changed) => changed && router.replace('/driver-dashboard')); return; } if (driverApplication && driverApplication.status !== 'draft') { router.push('/driver-status'); return; } router.push({ pathname: '/account/[section]', params: { section: 'earn' } }); }} /> : null}<Button label="Save changes" fullWidth className="mt-lg" onPress={() => { updateProfile({ name, email }); Alert.alert('Profile updated', 'Your details have been saved.'); }} /><View className="mt-xl border-t border-border pt-lg"><Text variant="bodyMedium" color="danger">Delete account</Text><Text variant="caption" color="textMuted" className="mt-xs">Permanently remove your profile and saved account information.</Text><Button label="Delete account" variant="destructive" fullWidth className="mt-md" onPress={confirmAccountDeletion} /></View></>;
  if (section === 'services') return <><FeatureHero icon="◈" title="One app for every journey" detail="Request a car, send a package, plan ahead, or unlock member benefits from one place." /><ServiceCard icon="🚙" title="Ride" detail="Affordable everyday trips with live driver tracking" action="Book a ride" onPress={() => router.push('/set-destination')} /><ServiceCard icon="📦" title="Courier" detail="Door-to-door delivery for small packages across Lagos" action="Send a package" onPress={() => router.push({ pathname: '/set-destination', params: { service: 'courier' } })} /><ServiceCard icon="◷" title="Schedule a ride" detail="Choose your pickup time in advance for important journeys" action="Schedule" onPress={() => router.push({ pathname: '/set-destination', params: { service: 'scheduled' } })} /><ServiceCard icon="✚" title="Rakky Ride Plus" detail="Priority pickup, ride credit, and member-only offers" action="View benefits" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'ride-plus' } })} /></>;
  if (section === 'payment') return <RiderWalletSection />;
  if (section === 'top-up') return <TopUpSection />;
  if (section === 'add-bank') return <AddBankSection />;
  if (section === 'withdraw') return <WithdrawSection />;
  if (section === 'trips' || section === 'driver-trips') return <TripHistory trips={trips} loading={tripsLoading} error={tripsError} onOpen={(id) => router.push({ pathname: '/trip-receipt', params: { tripId: id } })} />;
  if (section === 'support') return <><SupportRow title="Help with a recent trip" detail="Fare, driver, item, or safety issue" onPress={() => Alert.alert('Choose a trip', 'Select a trip from your history to contact support.')} /><SupportRow title="Payment and refunds" detail="Charges, receipts, and failed payments" onPress={() => Alert.alert('Payment support', 'Describe the charge and our support team will review it.')} /><SupportRow title="Account support" detail="Login, details, and accessibility" onPress={() => Alert.alert('Account support', 'Start a secure support conversation.')} /><Button label="Chat with support" fullWidth className="mt-lg" onPress={() => Alert.alert('Support chat', 'A support specialist will join shortly.')} /><Button label="Call support" variant="outline" fullWidth className="mt-sm" onPress={() => void Linking.openURL('tel:+2340000000000')} /></>;
  if (section === 'safety') return <><FeatureHero icon="◇" title="You’re in control" detail="Ride tracking, private calling, trusted contacts, and emergency help are available before and during trips." /><SettingRow title="Trusted contact" detail="Notify your chosen contact during a safety concern" value={trusted} onValueChange={setTrusted} /><InfoCard icon="⌘" title="Share a live trip" detail="Share driver, vehicle, and live location" action="Open" onPress={() => router.push('/ongoing-trip')} /><InfoCard icon="112" title="Emergency assistance" detail="Call Nigeria’s emergency response number" action="Call" onPress={() => void Linking.openURL('tel:112')} /></>;
  if (section === 'saved-places') return <><InfoCard icon="⌂" title="Home" detail="12 Road 12, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><InfoCard icon="▣" title="Work" detail="Admiralty Way, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><Button label="Add a saved place" variant="outline" fullWidth className="mt-md" onPress={() => router.push('/set-destination')} /></>;
  if (section === 'settings') return <><SettingRow title="Ride notifications" detail="Trip updates, driver arrival, and receipts" value={notifications} onValueChange={setNotifications} /><View className="mt-sm rounded-xl border border-border p-md"><Text variant="bodyMedium">Appearance</Text><Text variant="caption" color="textMuted">Choose your look or follow your device</Text><ThemePreferencePicker /></View><InfoCard icon="⌖" title="Location permissions" detail="Manage access in device settings" action="Open" onPress={() => void Linking.openSettings()} /><InfoCard icon="⌁" title="Privacy and data" detail="Download data or manage your account" action="View" onPress={() => Alert.alert('Privacy', 'Your privacy and data controls will appear here.')} /><Button label="Log out" variant="outline" fullWidth className="mt-lg" onPress={() => { logout(); router.replace('/welcome'); }} /></>;
  if (section === 'ride-plus') return <><FeatureHero icon="✚" title="Your rides, rewarded" detail="Get priority pickup, member-only offers, and 5% ride credit on eligible trips." /><Benefit text="5% credit on eligible rides" /><Benefit text="Priority support when you need help" /><Benefit text="Exclusive airport and weekend offers" /><Button label={joined ? 'Rakky Ride Plus activated' : 'Try Rakky Ride Plus free'} disabled={joined} fullWidth className="mt-xl" onPress={() => setJoined(true)} /></>;
  if (section === 'promotions') return <><Field label="Promo code" value={code} onChangeText={setCode} placeholder="Enter your code" autoCapitalize="characters" /><Button label="Apply code" fullWidth disabled={!code.trim()} onPress={() => { Alert.alert('Code applied', 'Your discount will appear before your next booking.'); setCode(''); }} /><View className="mt-xl rounded-2xl bg-primarySoft p-lg"><Text variant="caption" color="primary">ACTIVE OFFER</Text><Text variant="h3" className="mt-xs">10% launch discount</Text><Text variant="caption" color="textMuted" className="mt-xs">Automatically applied to eligible rides for a limited time.</Text></View></>;
  if (section === 'family') return <><FeatureHero icon="⌂" title="Travel together, pay once" detail="Invite family members, choose spending limits, and receive every trip receipt." /><Field label="Family member’s phone" value={code} onChangeText={setCode} placeholder="+234" keyboardType="phone-pad" /><Button label="Send invitation" fullWidth disabled={!code.trim()} onPress={() => { Alert.alert('Invitation sent', 'They’ll receive an invitation to join your Family Profile.'); setCode(''); }} /></>;
  if (section === 'work') return <><FeatureHero icon="▣" title="Separate work from personal" detail="Use a business payment method and receive organised monthly ride statements." /><Field label="Work email" value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" /><Button label="Create Work Profile" fullWidth disabled={!email.trim()} onPress={() => Alert.alert('Work Profile created', 'Your business rides can now be organised separately.')} /></>;
  if (section === 'driver-wallet') return <DriverWalletSection />;
  if (section === 'driver-earnings') return <DriverEarningsSection />;
  if (section === 'payouts') return <PayoutsSection />;
  if (section === 'vehicle-documents') return <><FeatureHero icon="🚘" title="Gray Mazda 5" detail="LND409HS · Economy and Comfort categories" /><InfoCard icon="✓" title="Vehicle inspection" detail="Verified · expires 12 Mar 2027" action="View" onPress={() => Alert.alert('Vehicle inspection', 'Your inspection document is verified.')} /><InfoCard icon="✓" title="Driver’s licence" detail="Verified · expires 8 Jan 2028" action="View" onPress={() => Alert.alert('Driver’s licence', 'Your licence is verified.')} /><InfoCard icon="!" title="Vehicle insurance" detail="Renew before 30 Sep 2026" action="Update" onPress={() => Alert.alert('Upload insurance', 'Choose a clear photo or PDF of your renewed insurance document.')} /><Button label="Add another vehicle" variant="outline" fullWidth className="mt-md" onPress={() => Alert.alert('Add vehicle', 'Vehicle registration will guide you through details, photos, and document checks.')} /></>;
  if (section === 'driver-rewards') return <><FeatureHero icon="★" title="8 of 12 trips completed" detail="Complete 4 more eligible trips by Sunday to earn a ₦5,000 bonus." /><View className="h-3 overflow-hidden rounded-full bg-surfaceMuted"><View className="h-full w-2/3 rounded-full bg-success" /></View><Text variant="caption" color="textMuted" className="mt-sm">67% complete · Lagos weekly challenge</Text><Text variant="bodyMedium" className="mb-sm mt-xl">Available campaigns</Text><InfoCard icon="↗" title="Friday evening boost" detail="Earn 15% more · 5 PM–10 PM" action="Details" onPress={() => Alert.alert('Friday boost', 'Eligible trips starting in Lagos between 5 PM and 10 PM receive the boost.')} /><InfoCard icon="⌖" title="Airport pickup reward" detail="Complete 3 airport pickups · ₦3,000" action="Track" onPress={() => Alert.alert('Airport reward', 'You have completed 1 of 3 eligible airport pickups.')} /></>;
  return <><FeatureHero icon="🚘" title="Drive when it works for you" detail="Go online, receive nearby requests, track earnings, and get paid securely." /><Benefit text="Choose your own driving hours" /><Benefit text="See trip destination and fare clearly" /><Benefit text="Safety support while you’re online" /><Button label={driverApplication?.status === 'approved' ? 'Switch to driver mode' : driverApplication?.status === 'pending' ? 'View application status' : driverApplication?.status === 'rejected' ? 'Review application' : 'Apply to drive'} fullWidth className="mt-xl" onPress={() => { if (driverApplication?.status === 'approved') { void setRole('driver').then((changed) => changed && router.replace('/driver-dashboard')); return; } if (driverApplication?.status === 'pending' || driverApplication?.status === 'rejected') { router.replace('/driver-status'); return; } restartDriverApplication(); router.replace('/driver-onboarding'); }} /></>;
}

function AvatarLetter({ value }: { value: string }) { return <View className="mb-xl items-center"><View className="h-24 w-24 items-center justify-center rounded-full bg-primarySoft"><Text variant="h1" color="primary">{value.slice(0, 1).toUpperCase()}</Text></View><Pressable className="mt-sm"><Text variant="caption" color="primary">Change photo</Text></Pressable></View>; }
function Field(props: ComponentProps<typeof TextInput> & { label: string }) { const theme = useTheme(); const { label, ...inputProps } = props; return <View className="mb-md"><Text variant="caption" color="textMuted" className="mb-xs">{label}</Text><TextInput selectionColor={theme.colors.primary} placeholderTextColor={theme.colors.textMuted} className="h-[52px] rounded-lg border border-borderStrong bg-surface px-md font-inter-regular text-body text-text outline-none" {...inputProps} /></View>; }
function InfoCard({ icon, title, detail, action, onPress }: { icon: string; title: string; detail: string; action: string; onPress?: () => void }) { return <Pressable onPress={onPress} className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color="icon">{icon}</Text></View><View className="ml-md flex-1 pr-sm"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Text variant="caption" color="primary" className="ml-sm shrink-0">{action}</Text></Pressable>; }
function ServiceCard({ icon, title, detail, action, onPress }: { icon: string; title: string; detail: string; action: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} onPress={onPress} className="mb-md overflow-hidden rounded-2xl border border-border bg-surface active:opacity-70"><View className="flex-row items-center p-md"><View className="h-14 w-14 items-center justify-center rounded-xl bg-primarySoft"><Text variant="h3" className="!text-[24px]">{icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{detail}</Text></View></View><View className="flex-row items-center justify-between border-t border-border bg-surfaceMuted px-md py-sm"><Text variant="caption" color="primary">{action}</Text><Text color="primary">→</Text></View></Pressable>; }
function FeatureHero({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <View className="mb-lg rounded-2xl bg-primarySoft p-lg"><View className="h-12 w-12 items-center justify-center rounded-xl bg-primary"><Text color="textInverse">{icon}</Text></View><Text variant="h3" className="mt-md !text-[21px]">{title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{detail}</Text></View>; }
function Benefit({ text }: { text: string }) { return <View className="flex-row items-center gap-md border-b border-border py-md"><View className="h-7 w-7 items-center justify-center rounded-full bg-successSoft"><Text color="success">✓</Text></View><Text variant="bodyMedium" className="flex-1">{text}</Text></View>; }
function SettingRow({ title, detail, value, onValueChange }: { title: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) { const theme = useTheme(); return <View className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }} thumbColor={theme.colors.surface} /></View>; }
function SupportRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) { return <Pressable onPress={onPress} className="flex-row items-center border-b border-border py-lg"><View className="flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Text color="icon">›</Text></Pressable>; }
function TripHistory({ trips, loading, error, onOpen }: { trips: Trip[]; loading: boolean; error: string | null; onOpen: (id: string) => void }) {
  if (loading) return <View className="items-center py-xl"><Text color="textMuted">Loading trips…</Text></View>;
  if (error) return <View className="rounded-xl bg-dangerSoft p-lg"><Text color="danger">{error}</Text></View>;
  if (!trips.length) return <View className="items-center rounded-xl bg-surfaceMuted p-xl"><Text variant="h3">No past trips yet</Text><Text variant="caption" color="textMuted" className="mt-xs text-center">Completed and cancelled trips will appear here.</Text></View>;
  return <>{trips.map((trip) => <TripCard key={trip.id} date={new Date(trip.completed_at ?? trip.requested_at).toLocaleString()} route={`${trip.pickup_address} → ${trip.dropoff_address}`} fare={`₦${Math.round((trip.driver_earning_kobo ?? trip.fare_kobo) / 100).toLocaleString()}`} status={trip.status.replaceAll('_', ' ')} onPress={() => onOpen(trip.id)} />)}</>;
}
function TripCard({ date, route, fare, status, onPress }: { date: string; route: string; fare: string; status: string; onPress?: () => void }) { return <Pressable onPress={onPress} className="mb-md rounded-xl border border-border bg-surface p-md"><View className="flex-row justify-between"><Text variant="caption" color="textMuted">{date}</Text><Text variant="caption" color={status === 'In progress' ? 'success' : 'textMuted'}>{status}</Text></View><Text variant="bodyMedium" className="mt-sm" numberOfLines={1}>{route}</Text><View className="mt-md flex-row items-center justify-between"><Text variant="caption" color="textMuted">View receipt and details</Text><Text variant="bodyMedium">{fare}</Text></View></Pressable>; }
