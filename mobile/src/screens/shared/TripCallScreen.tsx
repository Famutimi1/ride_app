import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

export function TripCallScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    participantName?: string | string[];
    phone?: string | string[];
    type?: string | string[];
  }>();
  const user = useAuthStore((state) => state.session?.user);
  const participantName = firstParam(params.participantName, user?.role === 'driver' ? 'Rider' : 'James');
  const participantPhone = firstParam(params.phone, '');
  const callType = firstParam(params.type, 'audio') === 'video' ? 'video' : 'audio';
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const initials = useMemo(() => participantName.trim().slice(0, 1).toUpperCase() || 'R', [participantName]);
  const callTime = `${String(Math.floor(callSeconds / 60)).padStart(2, '0')}:${String(callSeconds % 60).padStart(2, '0')}`;
  const returnToTrip = () => router.canGoBack() ? router.back() : router.replace('/ongoing-trip');

  useEffect(() => {
    const timer = setInterval(() => setCallSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!user) return null;

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={['top']} className="px-lg pt-sm">
        <View className="flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={returnToTrip} className="h-12 w-12 items-center justify-center rounded-full bg-surfaceMuted active:opacity-70">
            <Text variant="h3" className="!text-[22px]">←</Text>
          </Pressable>
          <View className="items-center">
            <Text variant="bodyMedium">{callType === 'video' ? 'Video call' : 'Audio call'}</Text>
            <View className="mt-xs flex-row items-center gap-xs"><View className="h-2 w-2 rounded-full bg-success" /><Text variant="caption" color="textMuted">Trip contact</Text></View>
          </View>
          <View className="h-12 w-12" />
        </View>
      </SafeAreaView>

      <View className="flex-1 items-center justify-center px-xl">
        {callType === 'video' ? (
          <View className="aspect-[3/4] w-full max-w-[380px] items-center justify-center overflow-hidden rounded-[30px] bg-surfaceMuted shadow-lg">
            <View className="h-28 w-28 items-center justify-center rounded-full bg-successSoft">
              <Text variant="h1" color="success">{initials}</Text>
            </View>
            <View className="mt-lg items-center gap-xs"><Text variant="h3" className="!text-[26px]">{participantName}</Text><Text color="textMuted">Ready for a video call</Text><View className="mt-sm rounded-full bg-surface px-lg py-sm"><Text variant="bodyMedium" color="primary">{callTime}</Text></View></View>
            <View className="absolute right-md top-md rounded-full bg-surface px-md py-sm"><Text variant="caption">You · {cameraOff ? 'Camera off' : 'Preview'}</Text></View>
          </View>
        ) : (
          <View className="items-center">
            <View className="h-36 w-36 items-center justify-center rounded-full bg-successSoft shadow-md">
              <Text variant="h1" color="success" className="!text-[52px]">{initials}</Text>
            </View>
            <View className="mt-xl items-center gap-xs"><Text variant="h2" className="!text-[30px]">{participantName}</Text><Text color="textMuted">Ready to call your trip contact</Text><View className="mt-sm rounded-full bg-primarySoft px-lg py-sm"><Text variant="bodyMedium" color="primary">{callTime}</Text></View></View>
          </View>
        )}
      </View>

      <View className="px-xl">
        <View className="flex-row justify-center gap-lg">
          <CallControl active={muted} icon={muted ? '×' : '♩'} label={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((value) => !value)} />
          <CallControl active={speaker} icon="◖" label="Speaker" onPress={() => setSpeaker((value) => !value)} />
          {callType === 'video' ? <CallControl active={cameraOff} icon="▣" label={cameraOff ? 'Camera on' : 'Camera off'} onPress={() => setCameraOff((value) => !value)} /> : null}
        </View>
        {callType === 'audio' ? (
          <Button label={participantPhone ? 'Start phone call' : 'Phone number unavailable'} disabled={!participantPhone} size="lg" fullWidth className="mt-xl" leftIcon={<Text color="textInverse">☎</Text>} onPress={() => participantPhone ? void Linking.openURL(`tel:${participantPhone}`) : undefined} />
        ) : (
          <Button label="Video calling setup required" disabled size="lg" fullWidth className="mt-xl" leftIcon={<Text color="textInverse">▣</Text>} onPress={() => setCameraOff(false)} />
        )}
        <Button label="End and return to trip" variant="destructive" size="lg" fullWidth className="mt-md" onPress={returnToTrip} />
        <Text variant="caption" color="textMuted" className="mt-md text-center">
          In-app media connection will activate when the calling provider is configured.
        </Text>
        <SafeAreaView edges={['bottom']} className="h-xl" />
      </View>
    </View>
  );
}

function CallControl({ active, icon, label, onPress }: { active: boolean; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} className="items-center active:opacity-70">
      <View className={`h-16 w-16 items-center justify-center rounded-full ${active ? 'bg-primary' : 'bg-surfaceMuted'}`}>
        <Text variant="h3" color={active ? 'textInverse' : 'text'} className="!text-[22px]">{icon}</Text>
      </View>
      <Text variant="caption" color="textMuted" className="mt-sm">{label}</Text>
    </Pressable>
  );
}
