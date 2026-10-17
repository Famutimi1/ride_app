import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input, Text } from '@/components/common';
import { useAuthStore, type DriverApplication } from '@/store/authStore';
import { apiErrorMessage } from '@/lib/apiClient';
import { DriverServiceChoices, DriverServiceConsent, DriverServiceEnrollmentScreen } from '@/components/common/DriverServiceSettings';
import { applyForDriverServices, getDriverServiceSettings, type DriverService, type DriverServiceSettings, savePersonalInfo, saveVehicleInfo, uploadDriverDocuments, type PickedDocument } from '@/services/driverService';

const STEP_TITLES = ['Choose your services', 'Personal information', 'Vehicle information', 'Required documents', 'Review application'] as const;

type ApplicationForm = Omit<DriverApplication, 'status' | 'submittedAt' | 'rejectionReason'>;

export function DriverOnboardingScreen() {
  const status=useAuthStore(state=>state.driverApplication?.status);
  const settings=useAuthStore(state=>state.driverServices);
  const incompletePending=status==='pending'&&settings&&(settings.vehicleCategory===null||(['ride','courier'] as const).some(service=>settings.services[service].status==='pending'&&!settings.services[service].consentAccepted));
  return status==='approved'||incompletePending?<DriverServiceEnrollmentScreen />:<DriverOnboardingForm />;
}

function DriverOnboardingForm() {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const existing = useAuthStore((state) => state.driverApplication);
  const submitDriverApplication = useAuthStore((state) => state.submitDriverApplication);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Partial<Record<'license' | 'vehicleRegistration' | 'insurance', PickedDocument>>>({});
  const [form, setForm] = useState<ApplicationForm>({
    personal: existing?.personal ?? { fullName: user?.name ?? '', email: user?.email ?? '', address: '' },
    vehicle: existing?.vehicle ?? { make: '', model: '', year: '', color: '', registrationNumber: '' },
    documents: existing?.documents ?? { driverLicence: '', vehicleRegistration: '', insurance: '' },
  });

  const [category,setCategory]=useState<'car'|'motorcycle'|null>(null);
  const [services,setServices]=useState<DriverService[]>([]);
  const [consentAccepted,setConsentAccepted]=useState(false);
  const [serviceSettings,setServiceSettings]=useState<DriverServiceSettings|null>(null);
  useEffect(()=>{let active=true;void getDriverServiceSettings().then(value=>{if(active)setServiceSettings(value);}).catch(()=>{if(active)setError('Could not load service choices. Reopen onboarding to retry.');});return()=>{active=false;};},[]);
  if (!user) return null;

  const updatePersonal = (field: keyof ApplicationForm['personal'], value: string) => {
    setError(undefined);
    setForm((current) => ({ ...current, personal: { ...current.personal, [field]: value } }));
  };
  const updateVehicle = (field: keyof ApplicationForm['vehicle'], value: string) => {
    setError(undefined);
    setForm((current) => ({ ...current, vehicle: { ...current.vehicle, [field]: value } }));
  };
  const updateDocument = (field: keyof ApplicationForm['documents'], value: string) => {
    setError(undefined);
    setForm((current) => ({ ...current, documents: { ...current.documents, [field]: value } }));
  };

  const validateStep = () => {
    if(step===0&&(!category||!services.length))return 'Choose your vehicle and the services you want to provide.';
    if(step===4&&(!serviceSettings||!consentAccepted))return 'Confirm your service choices before submitting.';
    if (step === 1 && (!form.personal.fullName.trim() || !form.personal.email.trim() || !form.personal.address.trim())) return 'Complete all personal information fields.';
    if (step === 2 && Object.values(form.vehicle).some((value) => !value.trim())) return 'Complete all vehicle information fields.';
    if (step === 3 && Object.values(form.documents).some((value) => !value.trim())) return 'Upload all three required documents.';
    return undefined;
  };

  const continueStep = async () => {
    const validationError = validateStep();
    if (validationError) { setError(validationError); return; }
    setError(undefined); setLoading(true);
    try {
      if (step === 1) await savePersonalInfo(form.personal);
      if (step === 2) await saveVehicleInfo(form.vehicle);
      if (step === 3) {
        const { license, vehicleRegistration, insurance } = selectedDocuments;
        if (!license || !vehicleRegistration || !insurance) throw new Error('Select all three documents again before continuing.');
        await uploadDriverDocuments({ license, vehicleRegistration, insurance });
      }
      if (step < 4) { setStep((current) => current + 1); return; }
      if(!category||!serviceSettings)throw new Error('Choose your services first.');
      const saved=await applyForDriverServices({services,vehicleCategory:category,consentVersion:serviceSettings.consent.version,consentAccepted:true,expectedVersion:serviceSettings.version});
      setServiceSettings(saved);
      await submitDriverApplication(form); router.replace('/driver-status');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <View className="flex-row items-center px-lg py-sm">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => step > 0 ? setStep((current) => current - 1) : router.replace('/home')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted active:opacity-70"><Text variant="h3" className="!text-[22px]">←</Text></Pressable>
        <View className="ml-md flex-1"><Text variant="bodyMedium">Driver application</Text><Text variant="caption" color="textMuted">Step {step + 1} of 5</Text></View>
        <Pressable onPress={() => router.replace('/home')}><Text variant="caption" color="primary">Exit</Text></Pressable>
      </View>

      <View className="flex-row gap-xs px-xl py-md">
        {STEP_TITLES.map((title, index) => <View key={title} className={`h-2 flex-1 rounded-full ${index <= step ? 'bg-primary' : 'bg-border'}`} />)}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-xl pb-xl" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="mb-xl mt-sm"><Text variant="h2" className="!text-[27px]">{STEP_TITLES[step]}</Text><Text color="textMuted" className="mt-xs">{step === 0 ? 'Your account is verified. Choose the work you want to provide.' : step === 1 ? 'Tell us who you are and where you operate.' : step === 2 ? 'Add the vehicle you will use for trips.' : step === 3 ? 'Upload clear photos or PDF copies for verification.' : 'Check everything carefully before submitting.'}</Text></View>

        {step === 0 ? <DriverServiceChoices category={category} services={services} onChange={(vehicle,selected)=>{setCategory(vehicle);setServices(selected);setConsentAccepted(false);}} /> : null}

        {step === 1 ? <View className="gap-lg"><Input label="Full name" value={form.personal.fullName} onChangeText={(value) => updatePersonal('fullName', value)} autoCapitalize="words" /><Input label="Email address" value={form.personal.email} onChangeText={(value) => updatePersonal('email', value)} keyboardType="email-address" autoCapitalize="none" /><Input label="Residential address" value={form.personal.address} onChangeText={(value) => updatePersonal('address', value)} /></View> : null}

        {step === 2 ? <View className="gap-lg"><View className="flex-row gap-md"><View className="flex-1"><Input label="Make" placeholder="Toyota" value={form.vehicle.make} onChangeText={(value) => updateVehicle('make', value)} /></View><View className="flex-1"><Input label="Model" placeholder="Corolla" value={form.vehicle.model} onChangeText={(value) => updateVehicle('model', value)} /></View></View><View className="flex-row gap-md"><View className="flex-1"><Input label="Year" placeholder="2021" value={form.vehicle.year} onChangeText={(value) => updateVehicle('year', value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" /></View><View className="flex-1"><Input label="Color" placeholder="Silver" value={form.vehicle.color} onChangeText={(value) => updateVehicle('color', value)} /></View></View><Input label="Registration number" placeholder="LND 123 AB" value={form.vehicle.registrationNumber} onChangeText={(value) => updateVehicle('registrationNumber', value.toUpperCase())} autoCapitalize="characters" /></View> : null}

        {step === 3 ? <View className="gap-md"><DocumentField id="driver-licence" title="Driver’s licence" detail="Front side, valid and readable" value={form.documents.driverLicence} onChange={(file) => { updateDocument('driverLicence', file.name); setSelectedDocuments((current) => ({...current,license:file})); }} /><DocumentField id="vehicle-registration" title="Vehicle registration" detail="Current registration document" value={form.documents.vehicleRegistration} onChange={(file) => { updateDocument('vehicleRegistration', file.name); setSelectedDocuments((current) => ({...current,vehicleRegistration:file})); }} /><DocumentField id="insurance" title="Vehicle insurance" detail="Valid policy document" value={form.documents.insurance} onChange={(file) => { updateDocument('insurance', file.name); setSelectedDocuments((current) => ({...current,insurance:file})); }} /><View className="rounded-xl bg-warningSoft p-md"><Text variant="caption" color="warning">Documents are reviewed before driver access is approved. Blurry or expired files may delay your application.</Text></View></View> : null}

        {step === 4 ? <View className="gap-md"><ReviewCard title="Service selection" lines={[category==='car'?'Car':'Motorcycle',services.map(service=>service==='ride'?'Passenger rides':'Courier deliveries').join(' and ')]} onEdit={()=>{setStep(0);setConsentAccepted(false);}} /><ReviewCard title="Personal information" lines={[form.personal.fullName, form.personal.email, form.personal.address]} onEdit={() => setStep(1)} /><ReviewCard title="Vehicle" lines={[`${form.vehicle.year} ${form.vehicle.color} ${form.vehicle.make} ${form.vehicle.model}`, form.vehicle.registrationNumber]} onEdit={() => setStep(2)} /><ReviewCard title="Documents" lines={[form.documents.driverLicence, form.documents.vehicleRegistration, form.documents.insurance]} onEdit={() => setStep(3)} /><View className="rounded-xl bg-primarySoft p-md"><Text variant="caption" color="primary">By submitting, you confirm that these details are accurate and belong to you.</Text></View>{serviceSettings?<DriverServiceConsent settings={serviceSettings} services={services} accepted={consentAccepted} onChange={setConsentAccepted} />:null}</View> : null}

        {error ? <Text variant="caption" color="danger" className="mt-lg">{error}</Text> : null}
      </ScrollView>

      <View className="border-t border-border bg-surface px-xl pt-md"><Button label={step === 4 ? 'Submit application' : 'Continue'} fullWidth size="lg" loading={loading} onPress={() => void continueStep()} /><SafeAreaView edges={['bottom']} className="h-sm" /></View>
    </SafeAreaView>
  );
}

function DocumentField({ id, title, detail, value, onChange }: { id: string; title: string; detail: string; value: string; onChange: (value: PickedDocument) => void }) {
  const selectDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (!result.canceled) onChange({name:result.assets[0].name,uri:result.assets[0].uri,mimeType:result.assets[0].mimeType,file:result.assets[0].file});
  };
  return <View className={`rounded-xl border p-lg ${value ? 'border-success bg-successSoft' : 'border-border bg-surface'}`} testID={`document-${id}`}><View className="flex-row items-center"><View className={`h-11 w-11 items-center justify-center rounded-lg ${value ? 'bg-success' : 'bg-surfaceMuted'}`}><Text color={value ? 'textInverse' : 'icon'}>{value ? '✓' : '↑'}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{title}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{value || detail}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${value ? 'Replace' : 'Upload'} ${title}`} onPress={() => void selectDocument()}><Text variant="caption" color="primary">{value ? 'Replace' : 'Upload'}</Text></Pressable></View></View>;
}

function ReviewCard({ title, lines, onEdit }: { title: string; lines: string[]; onEdit: () => void }) {
  return <View className="rounded-xl border border-border bg-surface p-lg"><View className="flex-row justify-between"><Text variant="bodyMedium">{title}</Text><Pressable onPress={onEdit}><Text variant="caption" color="primary">Edit</Text></Pressable></View>{lines.map((line) => <Text key={line} variant="caption" color="textMuted" className="mt-xs">{line}</Text>)}</View>;
}
