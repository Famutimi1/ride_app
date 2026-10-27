import { UserFacingError } from '@/utils/userMessage';
import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { useFinanceAction, useFinanceResource } from '@/hooks/useFinanceResource';
import { applicationDecision } from '@/utils/driverApplications';
import { DriverApplicationStatusView } from './DriverApplicationsView';

// Reuse the store's authenticated read so metadata and cross-screen decisions agree.
async function loadApplication() {
  const data = await useAuthStore.getState().refreshDriverApplication();
  if (!data) throw new UserFacingError('Sign in again to load your application.');
  return data;
}

export function DriverApplicationStatusScreen() {
  const router = useRouter();
  const userId = useAuthStore(state => state.session?.user.id);
  const application = useAuthStore(state => state.driverApplication);
  const services = useAuthStore(state => state.driverServices);
  const resource = useFinanceResource(loadApplication);
  const action = useFinanceAction();
  const refresh = resource.refresh;
  useEffect(() => {
    const interval = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!resource.loading && !resource.error && application?.status === 'draft') return <Redirect href="/driver-onboarding" />;
  const data = resource.data ? { ...resource.data, ...(application && application.status !== 'draft' ? { status: application.status, rejection_reason: application.rejectionReason } : {}), serviceSettings: services ?? resource.data.serviceSettings } : null;
  const support = () => router.push('/account/support');
  const primary = () => {
    if (!data || action.inFlight.current) return;
    const decision = applicationDecision(data);
    if (decision.destination === 'support') { support(); return; }
    if (decision.destination === 'selection') { router.push('/driver-onboarding'); return; }
    if (decision.destination === 'resubmit') { useAuthStore.getState().restartDriverApplication(); router.replace('/driver-onboarding'); return; }
    if (decision.destination === 'rider') { router.replace('/home'); return; }
    void action.run('dashboard', () => useAuthStore.getState().setRole('driver'), changed => {
      if (changed && useAuthStore.getState().session?.user.id === userId) router.replace('/driver-dashboard');
    }, true);
  };
  return <DriverApplicationStatusView data={data} loading={resource.loading} error={resource.error ?? action.error} busy={Boolean(action.busy)}
    onRefresh={() => { action.setError(null); void refresh(); }}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')}
    onPrimary={primary} onServices={() => router.push('/driver-onboarding')} onSupport={support} />;
}
