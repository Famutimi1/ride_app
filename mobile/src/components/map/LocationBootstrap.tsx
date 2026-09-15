import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal, Pressable, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { getCurrentCoordinate, getForegroundLocationPermission, requestForegroundLocation } from '@/services/locationService';
import { reverseGeocode } from '@/services/mapsService';
import { useMapStore } from '@/store/mapStore';

const EXPLAINER_SEEN_KEY = 'location-permission-explainer-seen-v2';

/** Runs once at signed-in app startup. The OS persists the permission choice;
 * this component persists whether our explanatory screen has been presented. */
export function LocationBootstrap() {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const setCurrent = useMapStore((state) => state.setCurrentLocation);
  const setPickup = useMapStore((state) => state.setPickupLocation);
  const setRegion = useMapStore((state) => state.setCameraRegion);
  const setLocating = useMapStore((state) => state.setLocating);

  const refreshLocation = async () => {
    setLocating(true);
    try {
      const coordinate = await getCurrentCoordinate();
      const resolved = await reverseGeocode(coordinate).catch(() => null);
      const location = resolved ?? { ...coordinate, address: 'Current location' };
      setCurrent(location); setPickup(location);
      setRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.014 });
    } finally { setLocating(false); }
  };

  useEffect(() => {
    void (async () => {
      const permission = await getForegroundLocationPermission();
      if (permission === 'granted') { await refreshLocation(); return; }
      if (!await AsyncStorage.getItem(EXPLAINER_SEEN_KEY)) setVisible(true);
    })();
  // Store actions are stable and this initialization should run once per launch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request = async () => {
    await AsyncStorage.setItem(EXPLAINER_SEEN_KEY, 'true'); setVisible(false);
    if (await requestForegroundLocation() === 'granted') await refreshLocation();
  };

  const skip = async () => {
    await AsyncStorage.setItem(EXPLAINER_SEEN_KEY, 'true'); setVisible(false);
  };

  return <Modal visible={visible} transparent animationType="fade">
    <View className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><View className="w-full rounded-2xl p-xl" style={{ backgroundColor: theme.colors.surface }}>
      <View className="mb-lg h-14 w-14 items-center justify-center rounded-full bg-primarySoft"><Text variant="h2" color="primary">◎</Text></View>
      <Text variant="h2">Use your current location</Text>
      <Text color="textMuted" className="mt-sm">Ride uses your location to center nearby cars and fill your pickup address. You can still enter an address manually.</Text>
      <View className="mt-xl"><Button label="Allow location" fullWidth onPress={() => void request()} /></View>
      <Pressable onPress={() => void skip()} className="mt-md items-center py-sm"><Text color="textMuted">Not now</Text></Pressable>
    </View></View>
  </Modal>;
}
