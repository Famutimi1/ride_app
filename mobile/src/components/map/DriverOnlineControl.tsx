import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/common';
import {
  requestDriverBackgroundLocation, requestForegroundLocation, startDriverBackgroundUpdates,
  startDriverLocationUpdates, stopDriverBackgroundUpdates,
} from '@/services/locationService';

export function DriverOnlineControl({ driverId }: { driverId: string }) {
  const [online, setOnline] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stopForeground = useRef<null | (() => void)>(null);

  const toggle = async () => {
    if (online) {
      stopForeground.current?.(); await stopDriverBackgroundUpdates(); setOnline(false); setMessage(null); return;
    }
    setMessage('Rakky Ride needs location access while you are online so nearby riders can find you.');
    const foreground = await requestForegroundLocation();
    if (foreground !== 'granted') { setMessage('Enable foreground location in Settings before going online.'); return; }
    const background = await requestDriverBackgroundLocation();
    if (background !== 'granted') { setMessage('Background access is needed to remain available when Rakky Ride is not open.'); return; }
    stopForeground.current = await startDriverLocationUpdates(driverId);
    await startDriverBackgroundUpdates(driverId);
    setOnline(true); setMessage(null);
  };

  return <View className="absolute left-lg right-lg top-[24%] rounded-xl bg-surface p-md shadow-md">
    <View className="flex-row items-center justify-between"><View><Text variant="bodyMedium">Driver mode</Text><Text variant="caption" color={online ? 'success' : 'textMuted'}>{online ? 'Online · sharing live location' : 'Offline'}</Text></View>
      <Pressable onPress={() => void toggle()} className={`rounded-full px-lg py-sm ${online ? 'bg-danger' : 'bg-success'}`}><Text variant="button" color="textInverse">{online ? 'Go offline' : 'Go online'}</Text></Pressable>
    </View>
    {message ? <Text variant="caption" color="textMuted" className="mt-sm">{message}</Text> : null}
  </View>;
}
