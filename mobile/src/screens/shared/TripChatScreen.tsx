import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import {
  sendTripMessage,
  subscribeToTripMessages,
  type TripMessage,
} from '@/services/socket';
import { useAuthStore } from '@/store/authStore';

const QUICK_REPLIES = ['I’m at the pickup point', 'I’ll be there shortly', 'Please call me'];

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function currentTime() {
  return Date.now();
}

export function TripChatScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    tripId?: string | string[];
    participantName?: string | string[];
  }>();
  const user = useAuthStore((state) => state.session?.user);
  const scrollRef = useRef<ScrollView>(null);
  const tripId = firstParam(params.tripId, 'active-trip');
  const participantName = firstParam(params.participantName, user?.role === 'driver' ? 'Rider' : 'James');
  const senderRole: 'rider' | 'driver' = user?.role === 'driver' ? 'driver' : 'rider';
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<TripMessage[]>([
    {
      id: 'welcome-message',
      tripId,
      senderId: 'trip-participant',
      senderRole: senderRole === 'rider' ? 'driver' : 'rider',
      text: senderRole === 'rider'
        ? 'Hi, I’m on my way. Please stay close to your pickup point.'
        : 'Hi, I’m at the pickup point and ready when you arrive.',
      sentAt: currentTime() - 60_000,
    },
  ]);

  useEffect(() => subscribeToTripMessages(tripId, (message) => {
    setMessages((current) => current.some((item) => item.id === message.id)
      ? current
      : [...current, message]);
  }), [tripId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const initials = useMemo(() => participantName.trim().slice(0, 1).toUpperCase() || 'R', [participantName]);
  const returnToTrip = () => router.canGoBack() ? router.back() : router.replace('/ongoing-trip');
  const send = (text = draft) => {
    const value = text.trim();
    if (!value || !user) return;
    const message: TripMessage = {
      id: `${user.id}-${currentTime()}`,
      tripId,
      senderId: user.id,
      senderRole,
      text: value,
      sentAt: currentTime(),
    };
    setMessages((current) => [...current, message]);
    setDraft('');
    sendTripMessage(message);
  };

  if (!user) return null;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['top']} className="border-b border-border bg-surface">
        <View className="h-16 flex-row items-center px-lg">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={returnToTrip} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted active:opacity-70">
            <Text variant="h3" className="!text-[22px]">←</Text>
          </Pressable>
          <View className="ml-md h-11 w-11 items-center justify-center rounded-full bg-successSoft">
            <Text variant="bodyMedium" color="success">{initials}</Text>
          </View>
          <View className="ml-sm flex-1">
            <Text variant="bodyMedium">{participantName}</Text>
            <View className="flex-row items-center gap-xs">
              <View className="h-2 w-2 rounded-full bg-success" />
              <Text variant="caption" color="textMuted">Active trip · live messages</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${participantName}`}
            onPress={() => router.push({ pathname: '/trip-call', params: { tripId, participantName, type: 'audio' } })}
            className="h-11 w-11 items-center justify-center rounded-full bg-primarySoft active:opacity-70"
          >
            <Text color="primary">☎</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <View className="border-b border-border bg-primarySoft px-xl py-sm">
        <Text variant="caption" color="primary" className="text-center">
          Keep pickup updates here while your trip is active.
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-lg py-xl"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-xl items-center">
          <Text variant="caption" color="textMuted">Today</Text>
        </View>
        {messages.map((message) => {
          const mine = message.senderId === user.id;
          return (
            <View key={message.id} className={`mb-sm ${mine ? 'items-end' : 'items-start'}`}>
              <View className={`max-w-[82%] rounded-2xl px-lg py-md ${mine ? 'rounded-br-sm bg-primary' : 'rounded-bl-sm bg-surfaceMuted'}`}>
                <Text color={mine ? 'textInverse' : 'text'}>{message.text}</Text>
              </View>
              <Text variant="caption" color="textMuted" className="mt-xs px-xs">
                {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{mine ? ' · Sent' : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <View className="border-t border-border bg-surface px-lg pt-sm">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm pb-sm">
          {QUICK_REPLIES.map((reply) => (
            <Pressable key={reply} onPress={() => send(reply)} className="rounded-full border border-borderStrong px-md py-sm active:opacity-70">
              <Text variant="caption">{reply}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View className="flex-row items-end gap-sm pb-sm">
          <View className="min-h-[48px] flex-1 justify-center rounded-[24px] bg-surfaceMuted px-lg py-sm">
            <TextInput
              accessibilityLabel="Message"
              className="max-h-24 border-0 p-0 font-inter-regular text-body text-text outline-none"
              multiline
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={theme.colors.textMuted}
              selectionColor={theme.colors.primary}
              value={draft}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!draft.trim()}
            onPress={() => send()}
            className={`h-12 w-12 items-center justify-center rounded-full bg-primary ${draft.trim() ? 'active:opacity-80' : 'opacity-40'}`}
          >
            <Text variant="h3" color="textInverse" className="!text-[21px]">↑</Text>
          </Pressable>
        </View>
        <SafeAreaView edges={['bottom']} />
      </View>
    </KeyboardAvoidingView>
  );
}
