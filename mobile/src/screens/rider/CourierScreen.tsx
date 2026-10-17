import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text } from '@/components/common';
import { useCourierDraftStore } from '@/store/courierDraftStore';
import { useMapStore } from '@/store/mapStore';

export function CourierScreen() {
  const router = useRouter();
  const draft = useCourierDraftStore((state) => state.draft);
  const setDraft = useCourierDraftStore((state) => state.setDraft);
  useEffect(() => { useMapStore.getState().clearTripMap(); }, []);
  const [description, setDescription] = useState(draft?.description ?? '');
  const [weight, setWeight] = useState(draft ? String(draft.weightKg) : '');
  const [recipientName, setRecipientName] = useState(draft?.recipientName ?? '');
  const [recipientPhone, setRecipientPhone] = useState(draft?.recipientPhone ?? '');
  const [pickupInstructions, setPickupInstructions] = useState(draft?.pickupInstructions ?? '');
  const [dropoffInstructions, setDropoffInstructions] = useState(draft?.dropoffInstructions ?? '');
  const [accepted, setAccepted] = useState(draft?.acceptedRestrictions ?? false);
  const [error, setError] = useState<string | null>(null);

  const continueToRoute = () => {
    const weightKg = Number(weight);
    if (description.trim().length < 3 || description.trim().length > 160) return setError('Describe the package in 3–160 characters.');
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5) return setError('Enter a package weight above 0 kg and no more than 5 kg.');
    if (recipientName.trim().length < 2 || recipientName.trim().length > 80) return setError('Enter the recipient’s full name.');
    if (!/^\+[1-9]\d{7,14}$/.test(recipientPhone.trim())) return setError('Enter the recipient’s phone in international format, for example +2348012345678.');
    if (pickupInstructions.length > 200 || dropoffInstructions.length > 200) return setError('Keep handoff instructions under 200 characters.');
    if (!accepted) return setError('Confirm that your package is sealed and contains no prohibited items.');
    setDraft({ description: description.trim(), weightKg, recipientName: recipientName.trim(), recipientPhone: recipientPhone.trim(), pickupInstructions: pickupInstructions.trim(), dropoffInstructions: dropoffInstructions.trim(), acceptedRestrictions: true });
    setError(null);
    router.push({ pathname: '/set-destination', params: { service: 'courier' } });
  };

  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
    <View className="flex-row items-center border-b border-border px-xl py-md"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} className="mr-md h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable><View><Text variant="h3">Send a package</Text><Text variant="caption" color="textMuted">Courier delivery across Lagos</Text></View></View>
    <ScrollView className="flex-1" contentContainerClassName="gap-md px-xl py-lg" keyboardShouldPersistTaps="handled">
      <View className="rounded-xl bg-primarySoft p-lg"><Text variant="h3" color="primary">A delivery, not a passenger ride</Text><Text color="textMuted" className="mt-xs">A driver collects your sealed package and takes it to your recipient. Meet the driver at pickup; the recipient must meet them at drop-off.</Text></View>
      <Text variant="h3">Package</Text>
      <Input label="What are you sending?" placeholder="e.g. Books in a sealed box" value={description} onChangeText={setDescription} maxLength={160} />
      <Input label="Approximate weight (kg)" placeholder="e.g. 1.5" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <Text variant="caption" color="textMuted">Up to 5 kg. The package must be sealed and fit comfortably in a car.</Text>
      <Text variant="h3" className="mt-md">Recipient</Text>
      <Input label="Recipient’s full name" placeholder="Full name" value={recipientName} onChangeText={setRecipientName} maxLength={80} />
      <Input label="Recipient’s phone number" placeholder="+2348012345678" value={recipientPhone} onChangeText={setRecipientPhone} keyboardType="phone-pad" autoCapitalize="none" />
      <Input label="Pickup instructions (optional)" placeholder="Where should the driver meet you?" value={pickupInstructions} onChangeText={setPickupInstructions} maxLength={200} />
      <Input label="Drop-off instructions (optional)" placeholder="Where should the recipient meet the driver?" value={dropoffInstructions} onChangeText={setDropoffInstructions} maxLength={200} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => setAccepted(!accepted)} className="mt-sm flex-row items-start gap-sm rounded-xl bg-surfaceMuted p-md"><Text color="primary">{accepted ? '☑' : '□'}</Text><Text className="flex-1">I confirm this package is sealed and contains no cash, weapons, drugs, hazardous goods, live animals, or other prohibited items.</Text></Pressable>
      <Text variant="caption" color="textMuted">Courier orders use your wallet. Your recipient will give the driver a six-digit delivery code at handoff; share it only with the recipient.</Text>
      {error ? <Text variant="caption" color="danger">{error}</Text> : null}
    </ScrollView>
    <View className="border-t border-border bg-surface px-xl py-md"><Button label="Continue to pickup and drop-off" fullWidth onPress={continueToRoute} /></View>
  </SafeAreaView>;
}
