import { AppMessage } from '@/components/common/AppMessage';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, type InputProps } from '@/components/common';
import { AddressIcon } from '@/components/map/AddressIcon';
import { RideIcon } from '@/components/common/RideIcon';
import { nativeWindTheme, radius, spacing, typography, useTheme } from '@/constants/theme';
import { useCourierDraftStore } from '@/store/courierDraftStore';
import { useMapStore } from '@/store/mapStore';

export function CourierScreen() {
  const router = useRouter();
  const { review, retry } = useLocalSearchParams<{ review?: string; retry?: string }>();
  const { colors, scheme } = useTheme();
  const draft = useCourierDraftStore((state) => state.draft);
  const setDraft = useCourierDraftStore((state) => state.setDraft);
  useEffect(() => { if (review !== '1' && retry !== '1') useMapStore.getState().clearTripMap(); }, [review, retry]);
  const [description, setDescription] = useState(draft?.description ?? '');
  const [weight, setWeight] = useState(draft ? String(draft.weightKg) : '');
  const [recipientName, setRecipientName] = useState(draft?.recipientName ?? '');
  const [recipientPhone, setRecipientPhone] = useState(draft?.recipientPhone ?? '');
  const [pickupInstructions, setPickupInstructions] = useState(draft?.pickupInstructions ?? '');
  const [dropoffInstructions, setDropoffInstructions] = useState(draft?.dropoffInstructions ?? '');
  const [accepted, setAccepted] = useState(draft?.acceptedRestrictions ?? false);
  const scrollRef = useRef<ScrollView>(null);
  const formTop = useRef(0);
  const fieldTop = useRef<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearField = (field: string) => setFieldErrors(current => ({ ...current, [field]: '' }));
  const invalid = (field: string, message: string) => {
    setFieldErrors({ [field]: message });
    setError(null);
    scrollRef.current?.scrollTo({ y: Math.max(0, formTop.current + (fieldTop.current[field] ?? 0) - 12), animated: true });
  };
  const [error, setError] = useState<string | null>(null);
  const [pickupExpanded, setPickupExpanded] = useState(Boolean(draft?.pickupInstructions));
  const [weightOpen, setWeightOpen] = useState(false);
  const [exactWeight, setExactWeight] = useState(weight);
  const [weightError, setWeightError] = useState<string | null>(null);

  const chooseWeight = (value: string) => {
    const weightKg = Number(value);
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5) {
      setWeightError('Choose a weight above 0 kg and no more than 5 kg.');
      return;
    }
    setWeight(value);
    clearField('weight');
    setWeightError(null);
    setWeightOpen(false);
  };

  const continueToRoute = () => {
    const weightKg = Number(weight);
    if (description.trim().length < 3 || description.trim().length > 160) return invalid('description', 'Describe the package in 3–160 characters.');
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5) return invalid('weight', 'Enter a package weight above 0 kg and no more than 5 kg.');
    if (recipientName.trim().length < 2 || recipientName.trim().length > 80) return invalid('recipientName', 'Enter the recipient’s full name.');
    if (!/^\+[1-9]\d{7,14}$/.test(recipientPhone.trim())) return invalid('recipientPhone', 'Enter the recipient’s phone in international format, for example +2348012345678.');
    if (pickupInstructions.length > 200 || dropoffInstructions.length > 200) return setError('Keep handoff instructions under 200 characters.');
    if (!accepted) return setError('Confirm that your package is sealed and contains no prohibited items.');
    setDraft({ description: description.trim(), weightKg, recipientName: recipientName.trim(), recipientPhone: recipientPhone.trim(), pickupInstructions: pickupInstructions.trim(), dropoffInstructions: dropoffInstructions.trim(), acceptedRestrictions: true });
    setError(null);
    if (review === '1') router.back();
    else router.push({ pathname: '/set-destination', params: { service: 'courier' } });
  };

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={19} /></Pressable>
      </View>

      <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.copy}><Text variant="h2" accessibilityRole="header">Send a package</Text><Text variant="body" color="textMuted" style={styles.subtitle}>Sealed packages, up to 5 kg.</Text></View>
          <Image source={require('@/assets/images/home-v2/courier.png')} contentFit="contain" style={styles.package} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </View>

        <View style={styles.form} onLayout={event => { formTop.current = event.nativeEvent.layout.y; }}>
          <CourierField error={fieldErrors.description} onLayout={event => { fieldTop.current.description = event.nativeEvent.layout.y; }} label="Package description" placeholder="e.g. Documents, gifts, electronics" value={description} onChangeText={value => { setDescription(value); clearField('description'); }} maxLength={160} />
          <View style={styles.field} onLayout={event => { fieldTop.current.weight = event.nativeEvent.layout.y; }}>
            <Text variant="bodyMedium">Weight (kg)</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Select package weight" accessibilityHint="Choose a weight up to 5 kilograms" accessibilityState={{ expanded: weightOpen }} onPress={() => { setExactWeight(weight); setWeightError(null); setWeightOpen(true); }} style={[styles.weight, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text variant="body" color={weight ? 'text' : 'textMuted'} style={styles.copy}>{weight ? `${weight} kg` : 'Select weight'}</Text><RideIcon name="down" size={16} color="textMuted" />
            </Pressable>
            {fieldErrors.weight ? <AppMessage compact message={fieldErrors.weight} /> : null}
          </View>
          <CourierField error={fieldErrors.recipientName} onLayout={event => { fieldTop.current.recipientName = event.nativeEvent.layout.y; }} label="Recipient name" placeholder="Full name" value={recipientName} onChangeText={value => { setRecipientName(value); clearField('recipientName'); }} maxLength={80} autoComplete="off" />
          <CourierField error={fieldErrors.recipientPhone} onLayout={event => { fieldTop.current.recipientPhone = event.nativeEvent.layout.y; }} label="Recipient phone" placeholder="e.g. +2348012345678" value={recipientPhone} onChangeText={value => { setRecipientPhone(value); clearField('recipientPhone'); }} keyboardType="phone-pad" autoCapitalize="none" autoCorrect={false} maxLength={16} />
          <CourierField label="Delivery notes (optional)" placeholder="Gate, landmark or instructions" value={dropoffInstructions} onChangeText={setDropoffInstructions} maxLength={200} rightIcon={<Pressable accessibilityRole="button" accessibilityLabel={pickupExpanded ? 'Hide pickup instructions' : 'Add pickup instructions'} accessibilityHint="Optional instructions for the driver at pickup" accessibilityState={{ expanded: pickupExpanded }} onPress={() => setPickupExpanded(value => !value)} style={styles.pickupToggle}><RideIcon name={pickupExpanded ? 'minus' : 'plus'} size={16} color="primary" /></Pressable>} />
          {pickupExpanded ? <CourierField label="Pickup instructions (optional)" placeholder="Where should the driver meet you?" value={pickupInstructions} onChangeText={setPickupInstructions} maxLength={200} /> : null}
        </View>

        <View style={styles.bottom}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="I confirm my package is sealed and contains no prohibited items" accessibilityState={{ checked: accepted }} onPress={() => { setAccepted(value => !value); setError(null); }} style={[styles.restrictions, { backgroundColor: colors.dangerSoft }]}>
          <RideIcon name="safety" size={24} color="danger" /><Text variant="caption" style={styles.copy}>No cash, weapons, drugs, hazardous goods, live animals or prohibited items. Packages may be inspected.</Text>
          <View style={[styles.checkbox, { borderColor: accepted ? colors.primary : colors.borderStrong, backgroundColor: accepted ? colors.primary : colors.surface }]}>{accepted ? <RideIcon name="check" size={13} color="textInverse" /> : null}</View>
        </Pressable>
        <View style={[styles.noticeRow, styles.wallet, { backgroundColor: colors.primarySoft }]}><RideIcon name="wallet" size={24} color="primary" /><Text variant="caption" style={styles.copy}>Payment is made from your wallet when you confirm the delivery.</Text></View>
        {error ? <AppMessage message={error} style={styles.error} /> : null}
        <Pressable accessibilityRole="button" onPress={continueToRoute} style={[styles.continueButton, { backgroundColor: colors.primary }]}><Text variant="bodyMedium" color="textInverse">{review === '1' ? 'Save changes' : 'Choose addresses'}</Text></Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={weightOpen} transparent animationType="fade" onRequestClose={() => setWeightOpen(false)}>
      <KeyboardAvoidingView style={[styles.modal, nativeWindTheme[scheme], { backgroundColor: colors.overlay }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close weight selector" style={StyleSheet.absoluteFill} onPress={() => setWeightOpen(false)} />
        <View accessibilityViewIsModal style={[styles.weightSheet, { backgroundColor: colors.surface }]}>
          <View style={styles.sheetHeader}><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>Package weight</Text><Pressable accessibilityRole="button" accessibilityLabel="Close package weight" onPress={() => setWeightOpen(false)} style={styles.sheetClose}><RideIcon name="close" size={18} /></Pressable></View>
          <Text variant="caption" color="textMuted">Choose an estimate or enter an exact weight. Maximum 5 kg.</Text>
          <View style={styles.weightOptions}>{['0.5', '1', '2', '3', '4', '5'].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} kg`} accessibilityState={{ checked: weight === value }} onPress={() => chooseWeight(value)} style={[styles.weightOption, { borderColor: weight === value ? colors.primary : colors.border, backgroundColor: weight === value ? colors.primarySoft : colors.surface }]}><Text variant="button" color={weight === value ? 'primary' : 'text'}>{value} kg</Text></Pressable>)}</View>
          <CourierField label="Exact weight (kg)" placeholder="e.g. 1.5" value={exactWeight} onChangeText={value => { setExactWeight(value); setWeightError(null); }} keyboardType="decimal-pad" maxLength={6} error={weightError ?? undefined} />
          <Button label="Use this weight" fullWidth onPress={() => chooseWeight(exactWeight)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}

function CourierField({ label, onLayout, ...props }: InputProps & { label: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={styles.field} onLayout={onLayout}><Text variant="bodyMedium">{label}</Text><Input {...props} accessibilityLabel={label} onFocus={event => { setFocused(true); props.onFocus?.(event); }} onBlur={event => { setFocused(false); props.onBlur?.(event); }} style={typography.body} containerStyle={{ backgroundColor: colors.surface, borderColor: props.error ? colors.danger : focused ? colors.primary : colors.border, minHeight: 44, paddingVertical: spacing.sm }} /></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, copy: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
  subtitle: { marginTop: spacing.xs }, package: { width: 90, height: 90 },
  form: { gap: spacing.sm }, field: { gap: spacing.xs },
  weight: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickupToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -spacing.sm, marginRight: -spacing.md },
  restrictions: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.xl, gap: spacing.sm },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center' },
  wallet: { padding: spacing.md, borderRadius: radius.xl },
  bottom: { gap: spacing.sm }, continueButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.xl, padding: spacing.md }, error: { marginBottom: spacing.xs },
  modal: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  weightSheet: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: spacing.lg, borderRadius: radius.xl, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center' }, sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weightOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  weightOption: { flexGrow: 1, flexBasis: '28%', minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md },
});
