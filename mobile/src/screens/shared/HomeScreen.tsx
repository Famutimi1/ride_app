/** Rider home: live map, destination search, and an adjustable address sheet. */
import { cssInterop } from 'nativewind';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, ThemeToggle } from '@/components/common';
import { DriverOnlineControl, RideMap } from '@/components/map';
import { useAuthStore } from '@/store/authStore';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

const QUICK_PLACES = [
  { id: 'home', icon: '⌂', label: 'Home', address: '12 Road 12, Lekki Phase 1' },
  { id: 'work', icon: '▣', label: 'Work', address: 'Admiralty Way, Lekki Phase 1' },
] as const;

const SERVICES = [
  { id: 'ride', icon: '🚙', label: 'Ride', detail: 'Everyday trips' },
  { id: 'comfort', icon: '🚘', label: 'Comfort', detail: 'More comfort' },
  { id: 'xl', icon: '🚐', label: 'XL', detail: 'Up to 6 seats' },
  { id: 'schedule', icon: '◷', label: 'Schedule', detail: 'Book ahead' },
] as const;

export function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);

  if (!user) return null;

  const openDestinationPage = () => router.push('/set-destination');

  return (
    <View className="flex-1 bg-background">
      <RideMap />
      {(user.role === 'driver' || user.role === 'both') ? <DriverOnlineControl driverId={user.id} /> : null}

      <StyledSafeAreaView edges={['top']} className="absolute left-lg right-lg top-0 pt-sm">
        <View className="flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="Open account menu" onPress={() => router.push('/menu')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-sm active:opacity-70">
            <Text variant="h3" className="!text-[22px]">☰</Text>
          </Pressable>
          <ThemeToggle floating />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open pickup and destination search"
          onPress={openDestinationPage}
          className="mt-md h-16 flex-row items-center gap-md rounded-full bg-surface px-lg shadow-md active:opacity-[0.9]"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-primarySoft">
            <Text variant="bodyMedium" color="primary">⌕</Text>
          </View>
          <View className="flex-1">
            <Text variant="caption" color="textMuted">Where to?</Text>
            <Text variant="bodyMedium" className="mt-1" numberOfLines={1}>
              Enter your destination
            </Text>
          </View>
          <Text variant="body" color="icon">›</Text>
        </Pressable>
      </StyledSafeAreaView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Center map on my current location"
        className="absolute right-lg top-[42%] h-12 w-12 items-center justify-center rounded-full bg-success shadow-md active:opacity-80"
      >
        <Text variant="h3" color="textInverse" className="!text-[22px]">◎</Text>
      </Pressable>

      <StyledSafeAreaView
        edges={['bottom']}
        className="absolute bottom-0 left-0 right-0 h-[48%] rounded-t-[28px] bg-surface pb-sm pt-md shadow-lg"
      >
          <ScrollView className="flex-1" contentContainerClassName="pb-md" showsVerticalScrollIndicator={false}>
          <View>
            <View className="mb-sm items-center">
              <View className="h-1 w-10 rounded-full bg-borderStrong" />
            </View>
            <View className="flex-row items-center justify-between px-xl">
              <Text variant="bodyMedium">Our services</Text>
              <Text variant="caption" color="primary">Explore</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm px-xl py-md">
              {SERVICES.map((service) => <Pressable key={service.id} onPress={openDestinationPage} className="w-28 rounded-xl bg-surfaceMuted p-md active:opacity-70"><Text variant="h3" className="!text-[25px]">{service.icon}</Text><Text variant="bodyMedium" className="mt-sm">{service.label}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{service.detail}</Text></Pressable>)}
            </ScrollView>
            <View className="mb-sm flex-row items-center justify-between px-xl">
              <Text variant="bodyMedium">Ride again</Text>
              <Text variant="caption" color="primary" onPress={openDestinationPage}>
                See all
              </Text>
            </View>
            {QUICK_PLACES.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Ride to ${place.label}`}
                onPress={openDestinationPage}
                className="mx-xl flex-row items-center gap-md border-t border-border py-sm active:opacity-60"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-surfaceMuted">
                  <Text variant="bodyMedium">{place.icon}</Text>
                </View>
                <View className="flex-1">
                  <Text variant="bodyMedium">{place.label}</Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {place.address}
                  </Text>
                </View>
                <Text variant="body" color="icon">›</Text>
              </Pressable>
            ))}
            <View className="mx-xl mt-xs flex-row items-center justify-center gap-sm rounded-lg bg-primarySoft px-md py-sm">
              <Text variant="caption" color="primary">🛡</Text>
              <Text variant="caption" color="primary">Trips are tracked for your safety</Text>
            </View>
          </View></ScrollView>
      </StyledSafeAreaView>
    </View>
  );
}
