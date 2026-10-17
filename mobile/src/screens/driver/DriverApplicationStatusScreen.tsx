import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

export function DriverApplicationStatusScreen() {
  const router = useRouter();
  const services = useAuthStore(state => state.driverServices);
  const application = useAuthStore(state => state.driverApplication);
  const restart = useAuthStore(state => state.restartDriverApplication);
  const setRole = useAuthStore(state => state.setRole);
  const refresh = useAuthStore(state => state.refreshDriverApplication);
  useEffect(() => {
    const reload = () => { if (AppState.currentState === 'active') void refresh().catch(() => {}); };
    reload();
    const interval = setInterval(reload, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!application || application.status === 'draft') return <Redirect href="/driver-onboarding" />;
  const states = services ? Object.values(services.services) : [];
  const hasSuspension = states.some(service => service.status === 'suspended');
  const blockedBySuspension = application.status === 'rejected' && hasSuspension;
  const needsSelection = application.status === 'pending' && services && (
    services.vehicleCategory === null || states.some(service => service.status === 'pending' && !service.consentAccepted)
  );
  const config = {
    pending: { icon: '◷', tone: 'warning' as const, surface: 'bg-warningSoft', title: 'Application under review', detail: 'We’re checking your personal, vehicle, and document information. We will notify you when the review is complete.' },
    approved: { icon: '✓', tone: 'success' as const, surface: 'bg-successSoft', title: 'Your account is approved', detail: 'Open your dashboard to choose which approved service requests to receive.' },
    rejected: { icon: '!', tone: 'danger' as const, surface: 'bg-dangerSoft', title: blockedBySuspension ? 'Service access suspended' : 'Application needs attention', detail: blockedBySuspension ? 'New requests are blocked for suspended services. Contact support about the review. You can still finish a job you already accepted.' : application.rejectionReason ?? 'One or more details could not be verified. Review your information and submit again.' },
  }[application.status];

  return <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
    <View className="flex-row items-center px-lg py-sm">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.replace('/home')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable>
      <Text variant="bodyMedium" className="ml-md">Driver application</Text>
    </View>
    <ScrollView className="flex-1" contentContainerClassName="px-xl py-lg gap-lg">
      <View className={`rounded-[24px] p-xl ${config.surface}`}>
        <Text variant="h2" color={config.tone}>{config.icon}</Text>
        <Text variant="h2" className="mt-lg">{config.title}</Text>
        <Text color="textMuted" className="mt-sm">{config.detail}</Text>
        <View className="mt-xl rounded-xl bg-surface p-lg">
          <StatusRow label="Personal information" complete />
          <StatusRow label="Vehicle information" complete />
          <StatusRow label="Required documents" complete />
          <StatusRow label="Review decision" complete={application.status !== 'pending'} />
          {services ? (['ride', 'courier'] as const).filter(service => services.services[service].status !== 'none').map(service => {
            const current = services.services[service];
            return <View key={service} className="mt-md">
              <Text variant="bodyMedium">{service === 'ride' ? 'Passenger rides' : 'Courier deliveries'}</Text>
              <Text variant="caption" color={current.status === 'suspended' || current.status === 'rejected' ? 'danger' : 'textMuted'}>{current.status === 'pending' ? 'Under review' : current.status === 'approved' ? 'Approved' : current.status === 'suspended' ? 'Suspended' : 'Rejected'} · Requests {current.enabled ? 'on' : 'off'}</Text>
              {current.review?.reason ? <Text variant="caption" color="textMuted">{current.review.reason}</Text> : null}
            </View>;
          }) : null}
        </View>
      </View>
      {application.status === 'pending' ? <Text variant="caption" color="textMuted">You can continue booking rides as a rider while you wait.</Text> : null}
    </ScrollView>
    <View className="px-xl py-md">
      {needsSelection ? <Button label="Complete service selection" fullWidth onPress={() => router.push('/driver-onboarding')} />
        : application.status === 'approved' ? <Button label="Go to driver dashboard" fullWidth onPress={() => { void setRole('driver').then(changed => changed && router.replace('/driver-dashboard')); }} />
        : blockedBySuspension ? <Button label="Contact support" fullWidth onPress={() => router.push('/account/support')} />
        : application.status === 'rejected' ? <Button label="Review and resubmit" fullWidth onPress={() => { restart(); router.replace('/driver-onboarding'); }} />
        : <Button label="Continue as rider" variant="outline" fullWidth onPress={() => router.replace('/home')} />}
    </View>
  </SafeAreaView>;
}

function StatusRow({ label, complete }: { label: string; complete: boolean }) {
  return <View className="flex-row items-center border-b border-border py-sm">
    <View className={`h-6 w-6 items-center justify-center rounded-full ${complete ? 'bg-successSoft' : 'bg-warningSoft'}`}><Text variant="caption" color={complete ? 'success' : 'warning'}>{complete ? '✓' : '…'}</Text></View>
    <Text variant="caption" className="ml-sm flex-1">{label}</Text>
  </View>;
}
