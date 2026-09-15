import { useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, PanResponder, Pressable, ScrollView, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { useMapStore } from '@/store/mapStore';

const FALLBACK_PICKUP = '8a Bola Ogunsanya Crescent, Lekki';
const FALLBACK_DROPOFF = 'Arepo Bus Stop, Balogun Crescent';

export function OngoingTripScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const region = useMapStore((state) => state.cameraRegion);
  const [sheetHeight, setSheetHeight] = useState(62);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const dragStart = useRef(62);
  const driverCoordinate = route[Math.floor(route.length * 0.42)] ?? pickup ?? region;
  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
    { ...driverCoordinate, id: 'active-driver', kind: 'driver' as const, heading: 42, title: 'James' },
  ], [driverCoordinate, dropoff, pickup]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => { dragStart.current = sheetHeight; },
    onPanResponderMove: (_, gesture) => setSheetHeight(Math.min(78, Math.max(43, dragStart.current - (gesture.dy / 8)))),
    onPanResponderRelease: (_, gesture) => setSheetHeight(gesture.dy < -35 ? 78 : gesture.dy > 35 ? 43 : 62),
  }), [sheetHeight]);
  const pickupAddress = pickup?.address ?? FALLBACK_PICKUP;
  const dropoffAddress = dropoff?.address ?? FALLBACK_DROPOFF;
  const shareRide = async () => Share.share({ message: `I’m on a Ride trip with James (LND409HS). From ${pickupAddress} to ${dropoffAddress}. Estimated arrival: 5:47 PM.` });
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/home');

  return <View className="flex-1 bg-background">
    <AppMap region={region} markers={markers} polyline={route} followsUserLocation mapPadding={{ top: 130, right: 42, bottom: 330, left: 42 }} />
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center gap-md">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable>
      <View className="flex-1 flex-row items-center rounded-xl bg-surface px-md py-sm shadow-md"><View className="mr-md h-11 w-11 items-center justify-center rounded-lg bg-successSoft"><Text variant="h2" color="success" className="!text-[27px]">↑</Text></View><View className="flex-1"><Text variant="bodyMedium">Continue straight</Text><Text variant="caption" color="textMuted">2.4 km · then keep right</Text></View></View>
    </View></SafeAreaView>
    <View className="absolute left-lg top-[31%] rounded-lg bg-success px-md py-sm shadow-md"><Text variant="caption" color="textInverse">Arrive by</Text><Text variant="bodyMedium" color="textInverse">5:47 PM</Text></View>

    <View className="absolute bottom-0 left-0 right-0 overflow-hidden rounded-t-[30px] bg-surface shadow-lg" style={{ height: `${sheetHeight}%` }}>
      <View className="h-11 items-center justify-center" {...panResponder.panHandlers}><View className="h-1 w-14 rounded-full bg-borderStrong" /></View>
      <ScrollView className="flex-1" contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
        <Text variant="caption" color="secondary" className="uppercase tracking-widest">Ride in progress</Text><Text variant="h2" className="mt-xs !text-[28px]">12 min to destination</Text><Text color="textMuted">Estimated arrival 5:47 PM</Text>
        <View className="mt-lg flex-row items-center"><View className="h-16 w-16 items-center justify-center rounded-full bg-successSoft"><Text variant="h2" color="success">J</Text></View><View className="ml-md flex-1"><Text variant="h3" className="!text-[20px]">James</Text><Text variant="bodyMedium">4.9 <Text color="warning">★</Text></Text><Text variant="caption" color="textMuted">LND409HS · Gray Mazda 5</Text></View><View className="h-16 w-24 items-center justify-center rounded-xl bg-surfaceMuted"><Text variant="h2" className="!text-[34px]">🚙</Text></View></View>
        <View className="mt-lg flex-row rounded-xl bg-surfaceMuted py-md"><TripAction icon="•••" label="Message" onPress={() => Alert.alert('Message James', 'Chat will stay available until your trip ends.')} /><View className="w-px bg-border" /><TripAction icon="☎" label="Call" onPress={() => setCallOpen(true)} /><View className="w-px bg-border" /><TripAction icon="◆" label="Safety" onPress={() => setSafetyOpen(true)} /></View>
        <View className="mt-md rounded-xl bg-surfaceMuted p-md"><RouteRow icon="●" color="success" value={pickupAddress} /><View className="ml-[6px] h-5 w-px border-l border-dashed border-borderStrong" /><RouteRow icon="●" color="text" value={dropoffAddress} /></View>
        <View className="mt-md flex-row items-center rounded-xl border border-border px-md py-md"><View className="mr-md h-10 w-10 items-center justify-center rounded-lg bg-successSoft"><Text color="success">▣</Text></View><View className="flex-1"><Text variant="caption" color="textMuted">Payment method</Text><Text variant="bodyMedium">Cash</Text></View><Text variant="bodyMedium">₦13,400</Text></View>
        <View className="mt-md rounded-xl border border-border p-md"><Text variant="bodyMedium">Trip details</Text><View className="mt-sm flex-row justify-between"><Text variant="caption" color="textMuted">Distance remaining</Text><Text variant="caption">8.6 km</Text></View><View className="mt-sm flex-row justify-between"><Text variant="caption" color="textMuted">Vehicle</Text><Text variant="caption">Gray Mazda 5 · 4 seats</Text></View></View>
        <Button label="Share ride details" size="lg" fullWidth className="mt-lg" onPress={() => void shareRide()} /><Pressable onPress={() => setSafetyOpen(true)} className="items-center py-lg"><Text variant="bodyMedium" color="danger">Emergency help</Text></Pressable>
      </ScrollView>
    </View>

    <Modal visible={callOpen} transparent animationType="fade" onRequestClose={() => setCallOpen(false)}><Pressable onPress={() => setCallOpen(false)} className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><Pressable onPress={(event) => event.stopPropagation()} className="w-full rounded-[24px] bg-surface p-lg" style={{ maxWidth: 350 }}><View className="flex-row items-center justify-between"><View><Text variant="h3" className="!text-[21px]">Call James</Text><Text variant="caption" color="textMuted">Choose how you want to connect</Text></View><Pressable onPress={() => setCallOpen(false)} className="h-9 w-9 items-center justify-center rounded-full bg-surfaceMuted"><Text>×</Text></Pressable></View><View className="mt-lg flex-row gap-md"><Pressable onPress={() => { setCallOpen(false); void Linking.openURL('tel:+2340000000000'); }} className="flex-1 items-center rounded-xl bg-primarySoft p-lg"><View className="h-12 w-12 items-center justify-center rounded-full bg-primary"><Text variant="h3" color="textInverse">☎</Text></View><Text variant="bodyMedium" className="mt-sm">Audio call</Text><Text variant="caption" color="textMuted">Uses your phone</Text></Pressable><Pressable onPress={() => { setCallOpen(false); Alert.alert('Video call', 'Starting a secure video call with James…'); }} className="flex-1 items-center rounded-xl bg-successSoft p-lg"><View className="h-12 w-12 items-center justify-center rounded-full bg-success"><Text variant="h3" color="textInverse">▣</Text></View><Text variant="bodyMedium" className="mt-sm">Video call</Text><Text variant="caption" color="textMuted">In-app video</Text></Pressable></View></Pressable></Pressable></Modal>

    <Modal visible={safetyOpen} transparent animationType="fade" onRequestClose={() => setSafetyOpen(false)}><Pressable onPress={() => setSafetyOpen(false)} className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><Pressable onPress={(event) => event.stopPropagation()} className="w-full rounded-[28px] bg-surface p-xl" style={{ maxWidth: 410 }}><View className="h-14 w-14 items-center justify-center rounded-full bg-dangerSoft"><Text variant="h3" color="danger">◆</Text></View><Text variant="h3" className="mt-md !text-[23px]">Safety center</Text><Text variant="caption" color="textMuted" className="mt-xs">Your trip and driver location are being tracked. Choose the help you need.</Text><Pressable className="mt-lg border-b border-border py-md" onPress={() => void shareRide()}><Text variant="bodyMedium">Share live trip</Text><Text variant="caption" color="textMuted">Send your ride details to someone you trust</Text></Pressable><Pressable className="border-b border-border py-md" onPress={() => void Linking.openURL('tel:112')}><Text variant="bodyMedium" color="danger">Call emergency services</Text><Text variant="caption" color="textMuted">Call Nigeria’s emergency number, 112</Text></Pressable><Button label="I’m okay — close" variant="secondary" fullWidth className="mt-lg" onPress={() => setSafetyOpen(false)} /></Pressable></Pressable></Modal>
  </View>;
}

function TripAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 items-center"><Text variant="bodyMedium" color="icon">{icon}</Text><Text variant="caption" color="textMuted" className="mt-xs">{label}</Text></Pressable>; }
function RouteRow({ icon, color, value }: { icon: string; color: 'success' | 'text'; value: string }) { return <View className="flex-row items-center gap-md"><Text color={color}>{icon}</Text><Text variant="bodyMedium" className="flex-1" numberOfLines={1}>{value}</Text></View>; }
