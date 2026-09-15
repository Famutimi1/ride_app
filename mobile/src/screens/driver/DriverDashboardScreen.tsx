import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, DriverOnlineControl, type AppMapMarker } from '@/components/map';
import { Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';

export function DriverDashboardScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const setRole = useAuthStore((state) => state.setRole);
  const current = useMapStore((state) => state.currentLocation);
  const region = useMapStore((state) => state.cameraRegion);
  if (!user) return null;
  const markers: AppMapMarker[] = current ? [{ ...current, id: 'driver-me', kind: 'driver', title: 'Your location' }] : [];

  return <View className="flex-1 bg-background">
    <View className="h-[47%]"><AppMap region={region} markers={markers} showsUserLocation followsUserLocation mapPadding={{ top: 85, right: 28, bottom: 115, left: 28 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center justify-between"><Pressable onPress={() => router.push('/menu')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">☰</Text></Pressable><View className="rounded-full bg-surface px-lg py-sm shadow-md"><Text variant="bodyMedium">Driver dashboard</Text></View></View></SafeAreaView>
    <DriverOnlineControl driverId={user.id} />
    <View className="absolute bottom-0 left-0 right-0 h-[56%] overflow-hidden rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><ScrollView className="flex-1" contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}><View className="flex-row items-center justify-between"><View><Text variant="caption" color="textMuted">Today’s earnings</Text><Text variant="h2" className="!text-[28px]">₦0</Text></View><View className="rounded-lg bg-successSoft px-md py-sm"><Text variant="caption" color="success">Ready to drive</Text></View></View><View className="mt-lg flex-row gap-sm"><Stat label="Trips" value="0" /><Stat label="Online" value="0h" /><Stat label="Rating" value="5.0 ★" /></View><Text variant="h3" className="mt-xl !text-[20px]">Drive overview</Text><View className="mt-sm rounded-xl bg-surfaceMuted p-lg"><Text variant="bodyMedium">Go online to receive requests</Text><Text variant="caption" color="textMuted" className="mt-xs">Your live location is shared only while you’re online. Nearby requests will appear here with pickup, destination, and fare.</Text></View><View className="mt-md rounded-xl border border-border p-md"><Text variant="bodyMedium">Weekly goal</Text><View className="mt-sm h-2 overflow-hidden rounded-full bg-surfaceMuted"><View className="h-full w-[8%] rounded-full bg-primary" /></View><Text variant="caption" color="textMuted" className="mt-sm">0 of 25 trips · Start your first trip today</Text></View></ScrollView><SafeAreaView edges={['bottom']} className="border-t border-border px-xl pt-md"><Pressable onPress={() => { setRole('rider'); router.replace('/home'); }} className="h-12 items-center justify-center rounded-xl border border-primary"><Text variant="button" color="primary">Switch to rider mode</Text></Pressable></SafeAreaView></View>
  </View>;
}

function Stat({ label, value }: { label: string; value: string }) { return <View className="flex-1 items-center rounded-xl bg-surfaceMuted py-md"><Text variant="h3" className="!text-[18px]">{value}</Text><Text variant="caption" color="textMuted">{label}</Text></View>; }
