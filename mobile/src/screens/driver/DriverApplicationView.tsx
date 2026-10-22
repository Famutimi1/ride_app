import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button, Text } from '@/components/common';
import { DriverServiceChoices } from '@/components/common/DriverServiceSettings';
import { RideIcon } from '@/components/common/RideIcon';
import { useTheme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import type { DriverService, DriverServiceSettings, PickedDocument } from '@/services/driverService';
import type { DriverApplication } from '@/store/authStore';

export type ApplicationForm = Omit<DriverApplication, 'status' | 'submittedAt' | 'rejectionReason'>;
type DocumentKey = keyof ApplicationForm['documents'];

const STEPS = [
  { title: 'Choose your services', detail: 'Choose your vehicle and the work you want.', short: 'Services' },
  { title: 'About you', detail: 'Confirm your contact details.', short: 'Personal details' },
  { title: 'Your vehicle', detail: 'Tell us what you’ll drive.', short: 'Vehicle' },
  { title: 'Upload documents', detail: 'Clear photos or PDFs work best.', short: 'Documents' },
  { title: 'Ready for review', detail: 'Check your details before sending.', short: 'Review' },
] as const;

interface DriverApplicationViewProps {
  step: number;
  form: ApplicationForm;
  category: 'car' | 'motorcycle' | null;
  services: DriverService[];
  serviceSettings: DriverServiceSettings | null;
  consentAccepted: boolean;
  loading: boolean;
  error?: string;
  onBack: () => void;
  onExit: () => void;
  onContinue: () => void;
  onEdit: (step: number) => void;
  onPersonalChange: (field: keyof ApplicationForm['personal'], value: string) => void;
  onVehicleChange: (field: keyof ApplicationForm['vehicle'], value: string) => void;
  onDocumentChange: (field: DocumentKey, document: PickedDocument) => void;
  onServicesChange: (category: 'car' | 'motorcycle', services: DriverService[]) => void;
  onConsentChange: (accepted: boolean) => void;
  onDocumentError: (message: string) => void;
  onReloadServices: () => void;
}

/** The five application pages share this frame; saving stays in the screen controller. */
export function DriverApplicationView({
  step, form, category, services, serviceSettings, consentAccepted, loading, error,
  onBack, onExit, onContinue, onEdit, onPersonalChange, onVehicleChange,
  onDocumentChange, onServicesChange, onConsentChange, onDocumentError, onReloadServices,
}: DriverApplicationViewProps) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const current = STEPS[step];
  const continueDisabled = (step === 0 && (!serviceSettings || !category || !services.length))
    || (step === 4 && (!serviceSettings || !consentAccepted));

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.frame}>
          <View style={styles.header}>
            <View pointerEvents={loading ? 'none' : 'auto'}><BackButton onPress={onBack} /></View>
            <Text variant="bodyMedium" style={styles.headerTitle}>Driver setup</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Exit driver setup" disabled={loading} onPress={onExit} style={styles.exit}>
              <Text variant="caption" color="textMuted">Exit</Text>
            </Pressable>
          </View>

          <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel="Application progress" accessibilityValue={{ min: 1, max: 5, now: step + 1, text: `Step ${step + 1} of 5: ${current.short}` }} aria-valuemin={1} aria-valuemax={5} aria-valuenow={step + 1} aria-valuetext={`Step ${step + 1} of 5: ${current.short}`}>
            <View style={styles.progressTrack}>
              {STEPS.map((item, index) => <View key={item.short} style={[styles.progressSegment, { backgroundColor: index <= step ? colors.primary : colors.border }]} />)}
            </View>
            <View style={styles.progressLabels}>
              <Text variant="caption">Step {step + 1} of 5</Text>
            </View>
          </View>

          <ScrollView ref={scroll} style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.intro, step === 4 && styles.reviewIntro]}>
              <View style={styles.introCopy}>
                <Text variant="h3" accessibilityRole="header">{current.title}</Text>
                <Text variant="caption" color="textMuted">{current.detail}</Text>
              </View>
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
                {category === 'motorcycle' ? <View style={[styles.car, step === 4 && styles.reviewCar, styles.motorcycle]}><RideIcon name="motorcycle" size={48} color="primary" /></View> : <Image source={require('@/assets/images/register-v1/car.png')} contentFit="contain" style={[styles.car, step === 4 && styles.reviewCar]} />}
              </View>
            </View>

            <View pointerEvents={loading ? 'none' : 'auto'}>
              {step === 0 ? <><DriverServiceChoices layout="onboarding" disabled={loading || !serviceSettings} lockedCategory={serviceSettings?.vehicleCategory != null} category={category} services={services} onChange={onServicesChange} />{!serviceSettings ? <Button label="Reload service choices" variant="ghost" onPress={onReloadServices} /> : null}</> : null}

              {step === 1 ? (
                <View style={styles.fields}>
                  <ApplicationInput label="Full name" icon="passenger" placeholder="Your full name" value={form.personal.fullName} onChangeText={value => onPersonalChange('fullName', value)} autoCapitalize="words" autoComplete="name" textContentType="name" editable={!loading} />
                  <ApplicationInput label="Email address" icon="mail" placeholder="you@example.com" value={form.personal.email} onChangeText={value => onPersonalChange('email', value)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" editable={!loading} />
                  <ApplicationInput label="Residential address" icon="location" placeholder="Street address and area" value={form.personal.address} onChangeText={value => onPersonalChange('address', value)} autoComplete="street-address" textContentType="fullStreetAddress" multiline editable={!loading} />
                </View>
              ) : null}

              {step === 2 ? (
                <View style={styles.fields}>
                  <View style={styles.fieldRow}>
                    <View style={styles.fieldColumn}><ApplicationInput label="Make" icon={category === 'motorcycle' ? 'motorcycle' : 'vehicle'} placeholder={category === 'motorcycle' ? 'Bajaj' : 'Toyota'} value={form.vehicle.make} onChangeText={value => onVehicleChange('make', value)} editable={!loading} /></View>
                    <View style={styles.fieldColumn}><ApplicationInput label="Model" placeholder={category === 'motorcycle' ? 'Boxer' : 'Corolla'} value={form.vehicle.model} onChangeText={value => onVehicleChange('model', value)} editable={!loading} /></View>
                  </View>
                  <View style={styles.fieldRow}>
                    <View style={styles.fieldColumn}><ApplicationInput label="Year" icon="calendar" placeholder="2021" value={form.vehicle.year} onChangeText={value => onVehicleChange('year', value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} editable={!loading} /></View>
                    <View style={styles.fieldColumn}><ApplicationInput label="Colour" placeholder="Silver" value={form.vehicle.color} onChangeText={value => onVehicleChange('color', value)} editable={!loading} /></View>
                  </View>
                  <ApplicationInput label="Registration number" icon="plate" placeholder="LND 123 AB" value={form.vehicle.registrationNumber} onChangeText={value => onVehicleChange('registrationNumber', value.toUpperCase())} autoCapitalize="characters" editable={!loading} />
                  <Text variant="caption" color="textMuted">One {category === 'motorcycle' ? 'motorcycle for courier deliveries' : 'car for all your services'}.</Text>
                </View>
              ) : null}

              {step === 3 ? (
                <View style={styles.fields}>
                  <DocumentField id="driver-licence" title="Driver’s licence" detail="A clear photo or PDF of your valid licence." value={form.documents.driverLicence} disabled={loading} onChange={file => onDocumentChange('driverLicence', file)} onError={onDocumentError} />
                  <DocumentField id="vehicle-registration" title="Vehicle registration" detail="A clear photo or PDF of your registration." value={form.documents.vehicleRegistration} disabled={loading} onChange={file => onDocumentChange('vehicleRegistration', file)} onError={onDocumentError} />
                  <DocumentField id="insurance" title="Vehicle insurance" detail="A clear photo or PDF of your valid insurance." value={form.documents.insurance} disabled={loading} onChange={file => onDocumentChange('insurance', file)} onError={onDocumentError} />
                  <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}>
                    <RideIcon name="info" size={18} color="warning" />
                    <Text variant="caption" color="textMuted" style={styles.noticeText}>Use valid, readable documents.</Text>
                  </View>
                </View>
              ) : null}

              {step === 4 ? (
                <View style={styles.reviewFields}>
                  <ReviewCard icon="passenger" title="Services" lines={[`${category === 'car' ? 'Car' : 'Motorcycle'} · ${services.map(service => service === 'ride' ? 'Passenger rides' : 'Courier deliveries').join(' & ')}`]} onEdit={() => onEdit(0)} />
                  <ReviewCard icon="passenger" title="Personal details" lines={[form.personal.fullName, form.personal.email, form.personal.address]} onEdit={() => onEdit(1)} />
                  <ReviewCard icon={category === 'motorcycle' ? 'motorcycle' : 'vehicle'} title="Vehicle" lines={[`${form.vehicle.make} ${form.vehicle.model} (${form.vehicle.year})`, `${form.vehicle.color} · ${form.vehicle.registrationNumber}`]} onEdit={() => onEdit(2)} />
                  <ReviewCard icon="receipt" title="Documents" lines={['Driver’s licence · Uploaded', 'Vehicle registration · Uploaded', 'Vehicle insurance · Uploaded']} onEdit={() => onEdit(3)} />
                  {serviceSettings ? <ApplicationConsent disabled={loading} settings={serviceSettings} services={services} accepted={consentAccepted} onChange={onConsentChange} /> : (
                    <View style={[styles.notice, { backgroundColor: colors.warningSoft }]}>
                      <View style={styles.noticeText}>
                        <Text variant="caption" color="textMuted">Service consent could not be loaded.</Text>
                        <Button label="Reload service details" variant="ghost" onPress={onReloadServices} />
                      </View>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View style={[styles.footer, { backgroundColor: colors.background }]}>
            {error ? <Text variant="caption" color="danger" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <Button label={step === 4 ? 'Submit application' : 'Continue'} fullWidth size="lg" className="!rounded-full" loading={loading} disabled={continueDisabled} rightIcon={<Text variant="button" color="textInverse">→</Text>} onPress={onContinue} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ApplicationInput({ label, icon, ...props }: TextInputProps & { label: string; icon?: Parameters<typeof RideIcon>[0]['name'] }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return <View style={styles.inputField}>
    <Text variant="button">{label}</Text>
    <View style={[styles.inputShell, props.multiline && styles.addressShell, { backgroundColor: colors.surfaceMuted, borderColor: focused ? colors.primary : colors.border }]}>
      {icon ? <RideIcon name={icon} size={20} color="icon" /> : null}
      <TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.textMuted} selectionColor={colors.primary} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="outline-none" style={[typography.body, styles.inputText, { color: colors.text }]} />
    </View>
  </View>;
}

function ApplicationConsent({ settings, services, accepted, onChange, disabled }: { settings: DriverServiceSettings; services: DriverService[]; accepted: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.consentSection}>
    <Pressable accessibilityRole="button" accessibilityLabel="Service request details" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.consentDetails}>
      <Text variant="caption" color="primary" style={styles.noticeText}>Service request details</Text>
      <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}><RideIcon name="down" size={16} color="primary" /></View>
    </Pressable>
    {expanded ? services.map(service => <Text key={service} variant="caption" color="textMuted">{settings.consent.descriptions[service]}</Text>) : null}
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Accept service selection consent" accessibilityState={{ checked: accepted, disabled }} aria-checked={accepted} disabled={disabled} onPress={() => onChange(!accepted)} style={styles.consentRow}>
      <View style={[styles.checkbox, { backgroundColor: accepted ? colors.primary : colors.surface, borderColor: accepted ? colors.primary : colors.borderStrong }]}>{accepted ? <RideIcon name="check" size={16} color="textInverse" /> : null}</View>
      <Text variant="caption" style={styles.noticeText}>I choose these services and confirm my information is accurate and my documents are valid.</Text>
    </Pressable>
  </View>;
}

function DocumentField({ id, title, detail, value, disabled, onChange, onError }: { id: string; title: string; detail: string; value: string; disabled: boolean; onChange: (value: PickedDocument) => void; onError: (message: string) => void }) {
  const { colors } = useTheme();
  const selectDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
      if (!result.canceled) {
        const file = result.assets[0];
        onChange({ name: file.name, uri: file.uri, mimeType: file.mimeType, file: file.file });
      }
    } catch {
      onError('Could not open your files. Try uploading the document again.');
    }
  };
  return (
    <View testID={`document-${id}`} style={[styles.documentCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.documentHeading}>
        <RideIcon name="receipt" size={24} color="icon" />
        <View style={styles.documentTitle}>
          <Text variant="button">{title}</Text>
          <Text variant="caption" color="textMuted">{detail}</Text>
        </View>
        <View style={[styles.documentStatus, { backgroundColor: value ? colors.success : colors.surface, borderColor: value ? colors.success : colors.borderStrong }]}>{value ? <RideIcon name="check" size={14} color="textInverse" /> : null}</View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${value ? 'Replace' : 'Upload'} ${title}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => void selectDocument()} style={[styles.uploadButton, { backgroundColor: value ? colors.successSoft : colors.surfaceMuted, borderColor: value ? colors.successSoft : colors.border }]}>
        <RideIcon name={value ? 'receipt' : 'upload'} size={18} color={value ? 'success' : 'icon'} />
        {value ? <Text variant="caption" color="textMuted" numberOfLines={2} style={styles.noticeText}>{value}</Text> : null}
        <Text variant="button" color={value ? 'primary' : 'text'}>{value ? 'Replace' : 'Upload file'}</Text>
      </Pressable>
    </View>
  );
}

function ReviewCard({ icon, title, lines, onEdit }: { icon: Parameters<typeof RideIcon>[0]['name']; title: string; lines: string[]; onEdit: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.reviewCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.reviewIcon}><RideIcon name={icon} size={22} color="icon" /></View>
      <View style={styles.reviewCopy}>
        <Text variant="button">{title}</Text>
        {lines.map((line, index) => <Text key={index} variant="caption" color="textMuted">{line}</Text>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${title.toLowerCase()}`} onPress={onEdit} style={styles.edit}>
        <Text variant="caption" color="primary">Edit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  frame: { flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  header: { minHeight: 64, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { flex: 1 },
  exit: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  progress: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12, gap: 10 },
  progressTrack: { flexDirection: 'row', gap: 6 },
  progressSegment: { flex: 1, height: 6, borderRadius: 4 },
  progressLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  body: { paddingHorizontal: 24, paddingBottom: 24 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 24, minHeight: 76 },
  introCopy: { flex: 1, gap: 6 },
  reviewIntro: { marginTop: 0, marginBottom: 16, minHeight: 64 },
  reviewCar: { width: 64, height: 64 },
  car: { width: 76, height: 76 },
  motorcycle: { alignItems: 'center', justifyContent: 'center' },
  fields: { gap: 14 },
  reviewFields: { gap: 10 },
  inputField: { gap: 8 },
  inputShell: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  inputText: { flex: 1, minWidth: 0, padding: 0 },
  addressShell: { minHeight: 76 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldColumn: { flex: 1, minWidth: 0 },
  notice: { borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1 },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  error: { marginBottom: 12 },
  documentCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  documentHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  documentStatus: { width: 20, height: 20, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  documentTitle: { flex: 1, gap: 3 },
  uploadButton: { minHeight: 44, borderWidth: 1, borderRadius: 10, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 10 },
  reviewCard: { borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reviewIcon: { paddingTop: 2 },
  reviewCopy: { flex: 1, gap: 2, minWidth: 0 },
  edit: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 3 },
  consentSection: { gap: 8 },
  consentDetails: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  consentRow: { minHeight: 44, flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
});
