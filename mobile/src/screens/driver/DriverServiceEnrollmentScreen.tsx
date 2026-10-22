import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { useFinanceAction, useFinanceResource } from '@/hooks/useFinanceResource';
import { applyForDriverServices } from '@/services/driverService';
import { validServiceApplication, type ServiceApplicationChoice } from '@/utils/driverApplications';
import { DriverServiceEnrollmentView } from './DriverApplicationsView';

async function loadServices() {
  const owner = useAuthStore.getState().session?.user.id;
  await useAuthStore.getState().refreshDriverServices();
  const state = useAuthStore.getState();
  if (!owner || state.session?.user.id !== owner || !state.driverServices) throw new Error('Sign in again to load your services.');
  return state.driverServices;
}

export function DriverServiceEnrollmentScreen() {
  const { service } = useLocalSearchParams<{ service?: string }>();
  const userId = useAuthStore(state => state.session?.user.id);
  return <ServiceEnrollment key={userId + ':' + (service ?? 'all')} requested={service} />;
}

export function ServiceEnrollment({ requested }: { requested?: string }) {
  const router = useRouter();
  const stored = useAuthStore(state => state.driverServices);
  const resource = useFinanceResource(loadServices);
  const action = useFinanceAction();
  const [submitted, setSubmitted] = useState(false);
  const settings = resource.data ? stored ?? resource.data : null;
  const hasApproval = settings && Object.values(settings.services).some(service => service.status === 'approved');
  const back = () => { if (!action.inFlight.current) router.replace(hasApproval ? '/driver-dashboard' : '/driver-status'); };
  const submit = (choice: ServiceApplicationChoice) => {
    const current = useAuthStore.getState().driverServices;
    if (action.inFlight.current || submitted || resource.loading || resource.error || !current) return;
    if (!validServiceApplication(current, choice)) { action.setError('Your service choices changed. Review them and try again.'); return; }
    void action.run('submit', async () => {
      await applyForDriverServices({ services: choice.services, vehicleCategory: choice.category, consentVersion: choice.consentVersion, consentAccepted: true, expectedVersion: choice.expectedVersion });
    }, () => {
      // A successful write remains successful even if the subsequent read fails.
      setSubmitted(true);
      void resource.refresh();
    });
  };
  return <DriverServiceEnrollmentView settings={settings} requested={requested} loading={resource.loading} error={action.error ?? resource.error}
    readError={Boolean(resource.error)} busy={Boolean(action.busy)} submitted={submitted}
    onReload={() => { if (!action.inFlight.current) { action.setError(null); void resource.refresh(); } }}
    onBack={back} onStatus={() => { if (!action.inFlight.current) router.replace('/driver-status'); }} onSubmit={submit} />;
}
