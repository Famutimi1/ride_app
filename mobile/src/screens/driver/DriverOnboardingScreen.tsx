import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { useAuthStore } from '@/store/authStore';
import { apiErrorMessage } from '@/lib/apiClient';
import { DriverServiceEnrollmentScreen } from '@/components/common/DriverServiceSettings';
import { applyForDriverServices, getDriverServiceSettings, type DriverService, type DriverServiceSettings, savePersonalInfo, saveVehicleInfo, uploadDriverDocuments, type PickedDocument } from '@/services/driverService';

import { DriverApplicationView, type ApplicationForm } from './DriverApplicationView';

export function DriverOnboardingScreen() {
  const status = useAuthStore(state => state.driverApplication?.status);
  const settings = useAuthStore(state => state.driverServices);
  const incompletePending = status === 'pending' && settings && (
    settings.vehicleCategory === null || (['ride', 'courier'] as const).some(service => (
      settings.services[service].status === 'pending' && !settings.services[service].consentAccepted
    ))
  );
  return status === 'approved' || incompletePending ? <DriverServiceEnrollmentScreen /> : <DriverOnboardingForm />;
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

  const [category, setCategory] = useState<'car' | 'motorcycle' | null>(null);
  const [services, setServices] = useState<DriverService[]>([]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [serviceSettings, setServiceSettings] = useState<DriverServiceSettings | null>(null);
  useEffect(() => {
    let active = true;
    void getDriverServiceSettings()
      .then(value => {
        if (!active) return;
        setServiceSettings(value);
        setCategory(value.vehicleCategory);
        setServices(value.vehicleCategory === 'motorcycle' ? ['courier'] : (['ride', 'courier'] as const).filter(service => value.services[service].status === 'pending'));
      })
      .catch(() => { if (active) setError('Could not load service choices. Reopen onboarding to retry.'); });
    return () => { active = false; };
  }, []);
  if (!user) return null;

  const updatePersonal = (field: keyof ApplicationForm['personal'], value: string) => {
    setError(undefined);
    setForm((current) => ({ ...current, personal: { ...current.personal, [field]: value } }));
  };
  const updateVehicle = (field: keyof ApplicationForm['vehicle'], value: string) => {
    setError(undefined);
    setForm((current) => ({ ...current, vehicle: { ...current.vehicle, [field]: value } }));
  };
  const updateDocument = (field: keyof ApplicationForm['documents'], document: PickedDocument) => {
    setError(undefined);
    setForm(current => ({ ...current, documents: { ...current.documents, [field]: document.name } }));
    const uploadKey = field === 'driverLicence' ? 'license' : field;
    setSelectedDocuments(current => ({ ...current, [uploadKey]: document }));
  };

  const validateStep = () => {
    if (step === 0 && (!serviceSettings || !category || !services.length)) return 'Choose your vehicle and the services you want to provide.';
    if (step === 4 && (!serviceSettings || !consentAccepted)) return 'Confirm your service choices before submitting.';
    if (step === 1 && (!form.personal.fullName.trim() || !form.personal.email.trim() || !form.personal.address.trim())) return 'Complete all personal information fields.';
    if (step === 2 && Object.values(form.vehicle).some((value) => !value.trim())) return 'Complete all vehicle information fields.';
    if (step === 3 && Object.values(form.documents).some((value) => !value.trim())) return 'Upload all three required documents.';
    return undefined;
  };

  const continueStep = async () => {
    if (loading) return;
    const validationError = validateStep();
    if (validationError) { setError(validationError); return; }
    setError(undefined);
    setLoading(true);
    try {
      if (step === 1) await savePersonalInfo(form.personal);
      if (step === 2) await saveVehicleInfo(form.vehicle);
      if (step === 3) {
        const { license, vehicleRegistration, insurance } = selectedDocuments;
        if (!license || !vehicleRegistration || !insurance) throw new Error('Select all three documents again before continuing.');
        await uploadDriverDocuments({ license, vehicleRegistration, insurance });
      }
      if (step < 4) { setStep((current) => current + 1); return; }
      if (!category || !serviceSettings) throw new Error('Choose your services first.');
      const saved = await applyForDriverServices({
        services, vehicleCategory: category, consentVersion: serviceSettings.consent.version,
        consentAccepted: true, expectedVersion: serviceSettings.version,
      });
      setServiceSettings(saved);
      await submitDriverApplication(form);
      router.replace('/driver-status');
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  };

  const goToStep = (next: number) => {
    if (loading) return;
    setStep(next);
    setError(undefined);
    if (next === 0) setConsentAccepted(false);
  };

  return (
    <DriverApplicationView
      step={step}
      form={form}
      category={category}
      services={services}
      serviceSettings={serviceSettings}
      consentAccepted={consentAccepted}
      loading={loading}
      error={error}
      onBack={() => {
        if (loading) return;
        if (step > 0) goToStep(step - 1);
        else router.replace('/home');
      }}
      onExit={() => { if (!loading) router.replace('/home'); }}
      onContinue={() => void continueStep()}
      onEdit={goToStep}
      onPersonalChange={updatePersonal}
      onVehicleChange={updateVehicle}
      onDocumentChange={updateDocument}
      onServicesChange={(vehicle, selected) => {
        if (loading || !serviceSettings || (serviceSettings.vehicleCategory !== null && serviceSettings.vehicleCategory !== vehicle)) return;
        setCategory(vehicle);
        setServices(selected);
        setConsentAccepted(false);
        setError(undefined);
      }}
      onConsentChange={setConsentAccepted}
      onDocumentError={setError}
      onReloadServices={() => {
        setError(undefined);
        void getDriverServiceSettings().then(value => {
          setServiceSettings(value);
          if (value.vehicleCategory !== null) {
            setCategory(value.vehicleCategory);
            setServices(current => value.vehicleCategory === 'motorcycle' ? ['courier'] : current);
          }
        }).catch(() => setError('Could not load service details. Try again.'));
      }}
    />
  );
}
