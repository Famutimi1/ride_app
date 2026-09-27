import { useState, type ComponentProps } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { ThemePreferencePicker } from '@/components/common/ThemePreferencePicker';
import { useAuthStore } from '@/store/authStore';

type SectionId = 'profile' | 'services' | 'payment' | 'trips' | 'support' | 'safety' | 'saved-places' | 'settings' | 'ride-plus' | 'promotions' | 'family' | 'work' | 'earn' | 'driver-wallet' | 'driver-earnings' | 'payouts' | 'driver-trips' | 'vehicle-documents' | 'driver-rewards';
type PaymentMethodId = 'cash' | 'wallet';
type PaymentStatus = 'Completed' | 'Pending' | 'Failed';
type PaymentFilter = 'All' | PaymentStatus;

const PAYMENT_TRANSACTIONS: readonly { id: string; title: string; detail: string; amount: string; status: PaymentStatus }[] = [
  { id: 'ride-0907', title: 'Ride payment', detail: '7 Sep · Admiralty Way → Victoria Island', amount: '−₦4,250', status: 'Completed' },
  { id: 'topup-0905', title: 'Wallet top-up', detail: '5 Sep · Paystack', amount: '+₦10,000', status: 'Completed' },
  { id: 'ride-0902', title: 'Ride payment', detail: '2 Sep · Ikoyi → Lekki Phase 1', amount: '−₦3,800', status: 'Completed' },
  { id: 'schedule-0901', title: 'Scheduled ride hold', detail: '1 Sep · Airport trip', amount: '₦0', status: 'Pending' },
  { id: 'topup-0828', title: 'Wallet top-up', detail: '28 Aug · Bank authorization declined', amount: '₦5,000', status: 'Failed' },
];

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
};

export function AccountSectionScreen() {
  const router = useRouter();
  const { section: rawSection } = useLocalSearchParams<{ section?: string }>();
  const section: SectionId = rawSection && rawSection in TITLES ? rawSection as SectionId : 'profile';
  const meta = TITLES[section];
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
  const logout = useAuthStore((state) => state.logout);
  const [name, setName] = useState(user?.name ?? 'Rider');
  const [email, setEmail] = useState(user?.email ?? '');
  const [code, setCode] = useState('');
  const [trusted, setTrusted] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [joined, setJoined] = useState(false);

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

  if (section === 'profile') return <><AvatarLetter value={name} /><Field label="Full name" value={name} onChangeText={setName} /><Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" /><Field label="Phone number" value={user?.phone ?? ''} editable={false} />{user?.role !== 'driver' ? <InfoCard icon="🚘" title="Drive with Rakky Ride" detail="Register your vehicle and receive nearby requests" action="Learn more" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'earn' } })} /> : null}<Button label="Save changes" fullWidth className="mt-lg" onPress={() => { updateProfile({ name, email }); Alert.alert('Profile updated', 'Your details have been saved.'); }} /><View className="mt-xl border-t border-border pt-lg"><Text variant="bodyMedium" color="danger">Delete account</Text><Text variant="caption" color="textMuted" className="mt-xs">Permanently remove your profile and saved account information.</Text><Button label="Delete account" variant="destructive" fullWidth className="mt-md" onPress={confirmAccountDeletion} /></View></>;
  if (section === 'services') return <><FeatureHero icon="◈" title="One app for every journey" detail="Request a car, send a package, plan ahead, or unlock member benefits from one place." /><ServiceCard icon="🚙" title="Ride" detail="Affordable everyday trips with live driver tracking" action="Book a ride" onPress={() => router.push('/set-destination')} /><ServiceCard icon="📦" title="Courier" detail="Door-to-door delivery for small packages across Lagos" action="Send a package" onPress={() => router.push({ pathname: '/set-destination', params: { service: 'courier' } })} /><ServiceCard icon="◷" title="Schedule a ride" detail="Choose your pickup time in advance for important journeys" action="Schedule" onPress={() => router.push({ pathname: '/set-destination', params: { service: 'scheduled' } })} /><ServiceCard icon="✚" title="Rakky Ride Plus" detail="Priority pickup, ride credit, and member-only offers" action="View benefits" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'ride-plus' } })} /></>;
  if (section === 'payment') return <PaymentSection />;
  if (section === 'trips') return <><TripCard date="Today · 5:47 PM" route="Lekki Phase 1 → Arepo Bus Stop" fare="₦13,400" status="In progress" onPress={() => router.push('/ongoing-trip')} /><TripCard date="7 Sep · 10:24 AM" route="Admiralty Way → Victoria Island" fare="₦4,250" status="Completed" /><TripCard date="2 Sep · 8:10 PM" route="Ikoyi → Lekki Phase 1" fare="₦3,800" status="Completed" /></>;
  if (section === 'support') return <><SupportRow title="Help with a recent trip" detail="Fare, driver, item, or safety issue" onPress={() => Alert.alert('Choose a trip', 'Select a trip from your history to contact support.')} /><SupportRow title="Payment and refunds" detail="Charges, receipts, and failed payments" onPress={() => Alert.alert('Payment support', 'Describe the charge and our support team will review it.')} /><SupportRow title="Account support" detail="Login, details, and accessibility" onPress={() => Alert.alert('Account support', 'Start a secure support conversation.')} /><Button label="Chat with support" fullWidth className="mt-lg" onPress={() => Alert.alert('Support chat', 'A support specialist will join shortly.')} /><Button label="Call support" variant="outline" fullWidth className="mt-sm" onPress={() => void Linking.openURL('tel:+2340000000000')} /></>;
  if (section === 'safety') return <><FeatureHero icon="◇" title="You’re in control" detail="Ride tracking, private calling, trusted contacts, and emergency help are available before and during trips." /><SettingRow title="Trusted contact" detail="Notify your chosen contact during a safety concern" value={trusted} onValueChange={setTrusted} /><InfoCard icon="⌘" title="Share a live trip" detail="Share driver, vehicle, and live location" action="Open" onPress={() => router.push('/ongoing-trip')} /><InfoCard icon="112" title="Emergency assistance" detail="Call Nigeria’s emergency response number" action="Call" onPress={() => void Linking.openURL('tel:112')} /></>;
  if (section === 'saved-places') return <><InfoCard icon="⌂" title="Home" detail="12 Road 12, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><InfoCard icon="▣" title="Work" detail="Admiralty Way, Lekki Phase 1" action="Edit" onPress={() => router.push('/set-destination')} /><Button label="Add a saved place" variant="outline" fullWidth className="mt-md" onPress={() => router.push('/set-destination')} /></>;
  if (section === 'settings') return <><SettingRow title="Ride notifications" detail="Trip updates, driver arrival, and receipts" value={notifications} onValueChange={setNotifications} /><View className="mt-sm rounded-xl border border-border p-md"><Text variant="bodyMedium">Appearance</Text><Text variant="caption" color="textMuted">Choose your look or follow your device</Text><ThemePreferencePicker /></View><InfoCard icon="⌖" title="Location permissions" detail="Manage access in device settings" action="Open" onPress={() => void Linking.openSettings()} /><InfoCard icon="⌁" title="Privacy and data" detail="Download data or manage your account" action="View" onPress={() => Alert.alert('Privacy', 'Your privacy and data controls will appear here.')} /><Button label="Log out" variant="outline" fullWidth className="mt-lg" onPress={() => { logout(); router.replace('/welcome'); }} /></>;
  if (section === 'ride-plus') return <><FeatureHero icon="✚" title="Your rides, rewarded" detail="Get priority pickup, member-only offers, and 5% ride credit on eligible trips." /><Benefit text="5% credit on eligible rides" /><Benefit text="Priority support when you need help" /><Benefit text="Exclusive airport and weekend offers" /><Button label={joined ? 'Rakky Ride Plus activated' : 'Try Rakky Ride Plus free'} disabled={joined} fullWidth className="mt-xl" onPress={() => setJoined(true)} /></>;
  if (section === 'promotions') return <><Field label="Promo code" value={code} onChangeText={setCode} placeholder="Enter your code" autoCapitalize="characters" /><Button label="Apply code" fullWidth disabled={!code.trim()} onPress={() => { Alert.alert('Code applied', 'Your discount will appear before your next booking.'); setCode(''); }} /><View className="mt-xl rounded-2xl bg-primarySoft p-lg"><Text variant="caption" color="primary">ACTIVE OFFER</Text><Text variant="h3" className="mt-xs">10% launch discount</Text><Text variant="caption" color="textMuted" className="mt-xs">Automatically applied to eligible rides for a limited time.</Text></View></>;
  if (section === 'family') return <><FeatureHero icon="⌂" title="Travel together, pay once" detail="Invite family members, choose spending limits, and receive every trip receipt." /><Field label="Family member’s phone" value={code} onChangeText={setCode} placeholder="+234" keyboardType="phone-pad" /><Button label="Send invitation" fullWidth disabled={!code.trim()} onPress={() => { Alert.alert('Invitation sent', 'They’ll receive an invitation to join your Family Profile.'); setCode(''); }} /></>;
  if (section === 'work') return <><FeatureHero icon="▣" title="Separate work from personal" detail="Use a business payment method and receive organised monthly ride statements." /><Field label="Work email" value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" /><Button label="Create Work Profile" fullWidth disabled={!email.trim()} onPress={() => Alert.alert('Work Profile created', 'Your business rides can now be organised separately.')} /></>;
  if (section === 'driver-wallet') return <><View className="rounded-2xl bg-successSoft p-lg"><Text variant="caption" color="success">AVAILABLE BALANCE</Text><Text variant="h2" className="mt-xs !text-[31px]">₦42,850</Text><Text variant="caption" color="textMuted" className="mt-xs">Next scheduled payout · Monday</Text><Button label="Request payout" fullWidth className="mt-lg" onPress={() => Alert.alert('Payout requested', 'Your payout request is being reviewed securely.')} /></View><View className="mt-md flex-row gap-sm"><Metric label="Today" value="₦8,400" /><Metric label="This week" value="₦42,850" /><Metric label="Tips" value="₦2,250" /></View><Text variant="bodyMedium" className="mb-sm mt-xl">Wallet tools</Text><InfoCard icon="★" title="Rewards & goals" detail="8 of 12 trips toward your ₦5,000 bonus" action="View" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-rewards' } })} /><InfoCard icon="▤" title="Payout account" detail="Access Bank · •••• 4092" action="Manage" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'payouts' } })} /><InfoCard icon="↗" title="Weekly statement" detail="Fares, tips, bonuses, and service fees" action="Open" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'driver-earnings' } })} /><Text variant="bodyMedium" className="mb-sm mt-xl">Recent payouts</Text><PayoutRow date="2 Sep" amount="₦31,200" status="Paid" /><PayoutRow date="26 Aug" amount="₦27,850" status="Paid" /></>;
  if (section === 'driver-earnings') return <><FeatureHero icon="₦" title="₦42,850 this week" detail="12 completed trips · ₦3,571 average per trip" /><View className="flex-row gap-sm"><Metric label="Today" value="₦8,400" /><Metric label="Tips" value="₦2,250" /><Metric label="Bonus" value="₦5,000" /></View><View className="mt-lg rounded-xl border border-border bg-surface p-md"><Text variant="bodyMedium">Earnings breakdown</Text><MoneyRow label="Trip fares" value="₦38,600" /><MoneyRow label="Tips" value="₦2,250" /><MoneyRow label="Campaign bonus" value="₦5,000" /><MoneyRow label="Service fee" value="−₦3,000" danger /><MoneyRow label="Net earnings" value="₦42,850" strong /></View><Button label="View weekly statement" variant="outline" fullWidth className="mt-md" onPress={() => Alert.alert('Statement ready', 'Your current weekly earnings statement is ready to review.')} /></>;
  if (section === 'payouts') return <><View className="rounded-2xl bg-successSoft p-lg"><Text variant="caption" color="success">AVAILABLE BALANCE</Text><Text variant="h2" className="mt-xs !text-[31px]">₦42,850</Text><Text variant="caption" color="textMuted" className="mt-xs">Next scheduled payout · Monday</Text><Button label="Request payout" fullWidth className="mt-lg" onPress={() => Alert.alert('Payout requested', 'Your payout request is being reviewed securely.')} /></View><Text variant="bodyMedium" className="mb-sm mt-xl">Payout account</Text><InfoCard icon="▤" title="Bank account" detail="Access Bank · •••• 4092" action="Edit" onPress={() => Alert.alert('Bank account', 'Bank-account verification will open here.')} /><Text variant="bodyMedium" className="mb-sm mt-xl">Recent payouts</Text><PayoutRow date="2 Sep" amount="₦31,200" status="Paid" /><PayoutRow date="26 Aug" amount="₦27,850" status="Paid" /></>;
  if (section === 'driver-trips') return <><TripCard date="Today · 5:47 PM" route="Lekki Phase 1 → Arepo Bus Stop" fare="₦10,050" status="Completed" /><TripCard date="Today · 1:20 PM" route="Victoria Island → Ikoyi" fare="₦4,100" status="Completed" /><TripCard date="Yesterday · 8:35 PM" route="Oniru → Lekki Phase 1" fare="₦5,700" status="Completed" /><Text variant="caption" color="textMuted">Driver earnings shown are net estimates. Final values appear in the weekly statement after trip review.</Text></>;
  if (section === 'vehicle-documents') return <><FeatureHero icon="🚘" title="Gray Mazda 5" detail="LND409HS · Economy and Comfort categories" /><InfoCard icon="✓" title="Vehicle inspection" detail="Verified · expires 12 Mar 2027" action="View" onPress={() => Alert.alert('Vehicle inspection', 'Your inspection document is verified.')} /><InfoCard icon="✓" title="Driver’s licence" detail="Verified · expires 8 Jan 2028" action="View" onPress={() => Alert.alert('Driver’s licence', 'Your licence is verified.')} /><InfoCard icon="!" title="Vehicle insurance" detail="Renew before 30 Sep 2026" action="Update" onPress={() => Alert.alert('Upload insurance', 'Choose a clear photo or PDF of your renewed insurance document.')} /><Button label="Add another vehicle" variant="outline" fullWidth className="mt-md" onPress={() => Alert.alert('Add vehicle', 'Vehicle registration will guide you through details, photos, and document checks.')} /></>;
  if (section === 'driver-rewards') return <><FeatureHero icon="★" title="8 of 12 trips completed" detail="Complete 4 more eligible trips by Sunday to earn a ₦5,000 bonus." /><View className="h-3 overflow-hidden rounded-full bg-surfaceMuted"><View className="h-full w-2/3 rounded-full bg-success" /></View><Text variant="caption" color="textMuted" className="mt-sm">67% complete · Lagos weekly challenge</Text><Text variant="bodyMedium" className="mb-sm mt-xl">Available campaigns</Text><InfoCard icon="↗" title="Friday evening boost" detail="Earn 15% more · 5 PM–10 PM" action="Details" onPress={() => Alert.alert('Friday boost', 'Eligible trips starting in Lagos between 5 PM and 10 PM receive the boost.')} /><InfoCard icon="⌖" title="Airport pickup reward" detail="Complete 3 airport pickups · ₦3,000" action="Track" onPress={() => Alert.alert('Airport reward', 'You have completed 1 of 3 eligible airport pickups.')} /></>;
  return <><FeatureHero icon="🚘" title="Drive when it works for you" detail="Go online, receive nearby requests, track earnings, and get paid securely." /><Benefit text="Choose your own driving hours" /><Benefit text="See trip destination and fare clearly" /><Benefit text="Safety support while you’re online" /><Button label="Switch to driver mode" fullWidth className="mt-xl" onPress={() => { setRole('driver'); router.replace('/driver-dashboard'); }} /></>;
}

function PaymentSection() {
  const router = useRouter();
  const [defaultMethod, setDefaultMethod] = useState<PaymentMethodId>('cash');
  const [filter, setFilter] = useState<PaymentFilter>('All');
  const transactions = filter === 'All' ? PAYMENT_TRANSACTIONS : PAYMENT_TRANSACTIONS.filter((transaction) => transaction.status === filter);
  const filters: readonly PaymentFilter[] = ['All', 'Completed', 'Pending', 'Failed'];

  return <>
    <View className="rounded-xl bg-primarySoft p-lg">
      <Text variant="caption" color="primary">RIDE WALLET</Text>
      <View className="mt-xs flex-row items-end justify-between">
        <View><Text variant="h2" className="!text-[28px]">₦0</Text><Text variant="caption" color="textMuted">Available balance</Text></View>
        <Button label="Top up" size="sm" onPress={() => Alert.alert('Top up wallet', 'Paystack’s secure funding flow will open here once the payment API is connected.')} />
      </View>
    </View>

    <View className="mt-md flex-row gap-sm">
      <Metric label="Spent this month" value="₦8,050" />
      <Metric label="Refunds" value="₦0" />
    </View>

    <View className="mb-sm mt-xl">
      <Text variant="bodyMedium">Payment methods</Text>
      <Text variant="caption" color="textMuted" className="mt-xs">Your default method is selected automatically for new rides. You can still change it before confirming.</Text>
    </View>
    <PaymentMethodCard icon="▣" title="Cash" detail="Pay your driver at the end of the trip" selected={defaultMethod === 'cash'} onPress={() => setDefaultMethod('cash')} />
    <PaymentMethodCard icon="◉" title="Rakky Ride wallet" detail="Use your available wallet balance" selected={defaultMethod === 'wallet'} onPress={() => setDefaultMethod('wallet')} />
    <PaymentMethodCard icon="▤" title="Debit or credit card" detail="Add securely through Paystack" action="Add card" onPress={() => Alert.alert('Add card', 'Paystack’s secure card setup will open here once the payment API is connected. Rakky Ride never stores your card details.')} />

    <View className="mb-sm mt-xl flex-row items-end justify-between">
      <View><Text variant="bodyMedium">Transaction history</Text><Text variant="caption" color="textMuted">Payments, top-ups, holds, and refunds</Text></View>
      <Pressable onPress={() => Alert.alert('Statement', 'Your monthly payment statement will be prepared here.')}><Text variant="caption" color="primary">Statement</Text></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm pb-md">
      {filters.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)} className={`rounded-full border px-md py-sm ${filter === item ? 'border-primary bg-primary' : 'border-borderStrong bg-surface'}`}><Text variant="caption" color={filter === item ? 'textInverse' : 'textMuted'}>{item}</Text></Pressable>)}
    </ScrollView>
    <View className="overflow-hidden rounded-xl border border-border bg-surface">
      {transactions.map((transaction) => <TransactionRow key={transaction.id} {...transaction} />)}
    </View>

    <Text variant="bodyMedium" className="mb-sm mt-xl">Payment help</Text>
    <InfoCard icon="⌑" title="Receipts and statements" detail="View or download payment records" action="Open" onPress={() => Alert.alert('Receipts', 'Choose a transaction above to view its receipt or request a monthly statement.')} />
    <InfoCard icon="?" title="Payment support" detail="Get help with a charge, refund, or failed payment" action="Get help" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'support' } })} />
    <Text variant="caption" color="textMuted" className="mt-md">Card details are processed by Paystack and are never stored by Rakky Ride.</Text>
  </>;
}

function PaymentMethodCard({ icon, title, detail, selected = false, action, onPress }: { icon: string; title: string; detail: string; selected?: boolean; action?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} className={`mb-sm flex-row items-center rounded-xl border p-md active:opacity-70 ${selected ? 'border-primary bg-primarySoft' : 'border-border bg-surface'}`}>
    <View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={selected ? 'primary' : 'icon'}>{icon}</Text></View>
    <View className="ml-md flex-1 pr-sm"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View>
    <Text variant="caption" color="primary">{selected ? 'Default ✓' : action ?? 'Set default'}</Text>
  </Pressable>;
}

function TransactionRow({ title, detail, amount, status }: { title: string; detail: string; amount: string; status: PaymentStatus }) {
  const statusColor = status === 'Completed' ? 'success' : status === 'Failed' ? 'danger' : 'warning';
  const statusBackground = status === 'Completed' ? 'bg-successSoft' : status === 'Failed' ? 'bg-dangerSoft' : 'bg-warningSoft';
  return <Pressable onPress={() => Alert.alert(title, `${detail}\n${amount} · ${status}`)} className="flex-row items-center border-b border-border p-md active:opacity-70">
    <View className={`h-10 w-10 items-center justify-center rounded-lg ${statusBackground}`}><Text color={statusColor}>{status === 'Completed' ? '✓' : status === 'Failed' ? '!' : '…'}</Text></View>
    <View className="ml-md flex-1 pr-sm"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{detail}</Text><Text variant="caption" color={statusColor} className="mt-xs">{status}</Text></View>
    <Text variant="bodyMedium" color={amount.startsWith('+') ? 'success' : 'text'} className="ml-sm shrink-0">{amount}</Text>
  </Pressable>;
}

function AvatarLetter({ value }: { value: string }) { return <View className="mb-xl items-center"><View className="h-24 w-24 items-center justify-center rounded-full bg-primarySoft"><Text variant="h1" color="primary">{value.slice(0, 1).toUpperCase()}</Text></View><Pressable className="mt-sm"><Text variant="caption" color="primary">Change photo</Text></Pressable></View>; }
function Field(props: ComponentProps<typeof TextInput> & { label: string }) { const theme = useTheme(); const { label, ...inputProps } = props; return <View className="mb-md"><Text variant="caption" color="textMuted" className="mb-xs">{label}</Text><TextInput selectionColor={theme.colors.primary} placeholderTextColor={theme.colors.textMuted} className="h-[52px] rounded-lg border border-borderStrong bg-surface px-md font-inter-regular text-body text-text outline-none" {...inputProps} /></View>; }
function InfoCard({ icon, title, detail, action, onPress }: { icon: string; title: string; detail: string; action: string; onPress?: () => void }) { return <Pressable onPress={onPress} className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color="icon">{icon}</Text></View><View className="ml-md flex-1 pr-sm"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Text variant="caption" color="primary" className="ml-sm shrink-0">{action}</Text></Pressable>; }
function ServiceCard({ icon, title, detail, action, onPress }: { icon: string; title: string; detail: string; action: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} onPress={onPress} className="mb-md overflow-hidden rounded-2xl border border-border bg-surface active:opacity-70"><View className="flex-row items-center p-md"><View className="h-14 w-14 items-center justify-center rounded-xl bg-primarySoft"><Text variant="h3" className="!text-[24px]">{icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{detail}</Text></View></View><View className="flex-row items-center justify-between border-t border-border bg-surfaceMuted px-md py-sm"><Text variant="caption" color="primary">{action}</Text><Text color="primary">→</Text></View></Pressable>; }
function FeatureHero({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <View className="mb-lg rounded-2xl bg-primarySoft p-lg"><View className="h-12 w-12 items-center justify-center rounded-xl bg-primary"><Text color="textInverse">{icon}</Text></View><Text variant="h3" className="mt-md !text-[21px]">{title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{detail}</Text></View>; }
function Benefit({ text }: { text: string }) { return <View className="flex-row items-center gap-md border-b border-border py-md"><View className="h-7 w-7 items-center justify-center rounded-full bg-successSoft"><Text color="success">✓</Text></View><Text variant="bodyMedium" className="flex-1">{text}</Text></View>; }
function SettingRow({ title, detail, value, onValueChange }: { title: string; detail: string; value: boolean; onValueChange: (value: boolean) => void }) { const theme = useTheme(); return <View className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }} thumbColor={theme.colors.surface} /></View>; }
function SupportRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) { return <Pressable onPress={onPress} className="flex-row items-center border-b border-border py-lg"><View className="flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Text color="icon">›</Text></Pressable>; }
function TripCard({ date, route, fare, status, onPress }: { date: string; route: string; fare: string; status: string; onPress?: () => void }) { return <Pressable onPress={onPress} className="mb-md rounded-xl border border-border bg-surface p-md"><View className="flex-row justify-between"><Text variant="caption" color="textMuted">{date}</Text><Text variant="caption" color={status === 'In progress' ? 'success' : 'textMuted'}>{status}</Text></View><Text variant="bodyMedium" className="mt-sm" numberOfLines={1}>{route}</Text><View className="mt-md flex-row items-center justify-between"><Text variant="caption" color="textMuted">View receipt and details</Text><Text variant="bodyMedium">{fare}</Text></View></Pressable>; }
function Metric({ label, value }: { label: string; value: string }) { return <View className="flex-1 items-center rounded-xl bg-surfaceMuted px-xs py-md"><Text variant="bodyMedium">{value}</Text><Text variant="caption" color="textMuted">{label}</Text></View>; }
function MoneyRow({ label, value, danger = false, strong = false }: { label: string; value: string; danger?: boolean; strong?: boolean }) { return <View className={`mt-md flex-row items-center justify-between ${strong ? 'border-t border-border pt-md' : ''}`}><Text variant={strong ? 'bodyMedium' : 'caption'} color={danger ? 'danger' : strong ? 'text' : 'textMuted'}>{label}</Text><Text variant={strong ? 'bodyMedium' : 'caption'} color={danger ? 'danger' : 'text'}>{value}</Text></View>; }
function PayoutRow({ date, amount, status }: { date: string; amount: string; status: string }) { return <View className="flex-row items-center border-b border-border py-md"><View className="h-9 w-9 items-center justify-center rounded-full bg-successSoft"><Text color="success">✓</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{amount}</Text><Text variant="caption" color="textMuted">{date}</Text></View><Text variant="caption" color="success">{status}</Text></View>; }
