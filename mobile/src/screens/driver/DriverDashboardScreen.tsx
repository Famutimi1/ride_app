import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, DriverOnlineControl, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useWalletStore } from '@/store/walletStore';
import { formatNaira, getEarningsSummary, type EarningsSummary } from '@/services/paymentService';

export function DriverDashboardScreen() {
  const router = useRouter();
  const theme = useTheme();
  const user = useAuthStore((state) => state.session?.user);
  const setRole = useAuthStore((state) => state.setRole);
  const driverApplication = useAuthStore((state) => state.driverApplication);
  const current = useMapStore((state) => state.currentLocation);
  const region = useMapStore((state) => state.cameraRegion);
  const offer = useTripStore((state) => state.offer);
  const acceptOffer = useTripStore((state) => state.acceptOffer);
  const declineOffer = useTripStore((state) => state.declineOffer);
  const loading = useTripStore((state) => state.loading);
  const error = useTripStore((state) => state.error);
  const wallet=useWalletStore();
  const refreshWallet=useWalletStore((state)=>state.refresh);
  const [earnings,setEarnings]=useState<EarningsSummary|null>(null);
  useEffect(()=>{void getEarningsSummary('today').then(setEarnings).catch(()=>{});void refreshWallet();},[refreshWallet]);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!offer) return;
    const receivedAt = offer.receivedAt ?? Date.now();
    const serverAtReceipt = offer.serverNow ? new Date(offer.serverNow).getTime() : receivedAt;
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - (serverAtReceipt + Date.now() - receivedAt)) / 1000)));
    update(); const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [offer]);
  if (!user) return null;
  if (driverApplication?.status !== 'approved') return <Redirect href={driverApplication?.status === 'pending' || driverApplication?.status === 'rejected' ? '/driver-status' : '/driver-onboarding'} />;
  const markers: AppMapMarker[] = current ? [{ ...current, id: 'driver-me', kind: 'driver', title: 'Your location' }] : [];

  const accept = async () => { try { await acceptOffer(); router.replace('/driver-trip'); } catch {} };
  return <View className="flex-1 bg-background">
    <View className="h-[47%]"><AppMap region={region} markers={markers} showsUserLocation followsUserLocation mapPadding={{ top: 85, right: 28, bottom: 115, left: 28 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center justify-between"><Pressable onPress={() => router.push('/menu')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">☰</Text></Pressable><View className="rounded-full bg-surface px-lg py-sm shadow-md"><Text variant="bodyMedium">Driver dashboard</Text></View></View></SafeAreaView>
    <DriverOnlineControl driverId={user.id} />
    <View className="absolute bottom-0 left-0 right-0 h-[56%] overflow-hidden rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><ScrollView className="flex-1" contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}><View className="flex-row items-center justify-between"><View><Text variant="caption" color="textMuted">Today’s earnings</Text><Text variant="h2" className="!text-[28px]">{formatNaira(earnings?.netKobo??0)}</Text></View><View className="rounded-lg bg-successSoft px-md py-sm"><Text variant="caption" color="success">{wallet.canGoOnline?'Ready to drive':'Cash debt limit'}</Text></View></View><View className="mt-lg flex-row gap-sm"><Stat label="Trips" value={String(earnings?.trips??0)} /><Stat label="Online" value="0h" /><Stat label="Rating" value="5.0 ★" /></View>{wallet.owedKobo>0?<View className="mt-md rounded-xl bg-dangerSoft p-md"><Text color="danger">You owe {formatNaira(wallet.owedKobo)} in cash commission.</Text><Button label="Pay now" className="mt-sm" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'top-up',target:'earnings'}})} /></View>:null}<Text variant="h3" className="mt-xl !text-[20px]">Drive overview</Text><View className="mt-sm rounded-xl bg-surfaceMuted p-lg"><Text variant="bodyMedium">Go online to receive requests</Text><Text variant="caption" color="textMuted" className="mt-xs">Your live location is shared only while you’re online. Nearby requests will appear here with pickup, destination, and fare.</Text></View><View className="mt-md rounded-xl border border-border p-md"><Text variant="bodyMedium">Weekly goal</Text><View className="mt-sm h-2 overflow-hidden rounded-full bg-surfaceMuted"><View className="h-full w-[8%] rounded-full bg-primary" /></View><Text variant="caption" color="textMuted" className="mt-sm">0 of 25 trips · Start your first trip today</Text></View></ScrollView><SafeAreaView edges={['bottom']} className="border-t border-border px-xl pt-md"><Pressable onPress={() => { void setRole('rider').then((changed) => changed && router.replace('/home')); }} className="h-12 items-center justify-center rounded-xl border border-primary"><Text variant="button" color="primary">Switch to rider mode</Text></Pressable></SafeAreaView></View>
    <Modal visible={Boolean(offer)} transparent animationType="slide" onRequestClose={() => void declineOffer()}><View className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><View className="rounded-t-[28px] bg-surface px-xl pb-xl pt-lg"><View className="items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><View className="mt-lg flex-row items-center justify-between"><View><Text variant="caption" color="secondary" className="uppercase tracking-widest">New ride request</Text><Text variant="h2" className="mt-xs">₦{Math.round((offer?.fareKobo ?? 0) / 100).toLocaleString()}</Text></View><View className="h-14 w-14 items-center justify-center rounded-full bg-primarySoft"><Text variant="h3" color="primary">{remaining}s</Text></View></View><Text variant="caption" color="textMuted" className="mt-md">{Math.max(0.1, (offer?.distanceToPickupM ?? 0) / 1000).toFixed(1)} km to pickup</Text><View className="mt-md rounded-xl bg-surfaceMuted p-md"><OfferRow label="Pickup" value={offer?.pickup.address ?? ''} /><View className="my-xs ml-[5px] h-4 w-px bg-borderStrong" /><OfferRow label="Destination" value={offer?.dropoff.address ?? ''} /></View>{error ? <Text variant="caption" color="danger" className="mt-sm">{error}</Text> : null}<Button label={remaining > 0 ? 'Accept trip' : 'Offer expired'} fullWidth disabled={remaining <= 0} loading={loading} className="mt-lg" onPress={() => void accept()} /><Button label="Decline" variant="ghost" fullWidth disabled={loading} onPress={() => void declineOffer()} /></View></View></Modal>
  </View>;
}

function Stat({ label, value }: { label: string; value: string }) { return <View className="flex-1 items-center rounded-xl bg-surfaceMuted py-md"><Text variant="h3" className="!text-[18px]">{value}</Text><Text variant="caption" color="textMuted">{label}</Text></View>; }
function OfferRow({ label, value }: { label: string; value: string }) { return <View className="flex-row gap-md"><Text color={label === 'Pickup' ? 'primary' : 'danger'}>●</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>; }
