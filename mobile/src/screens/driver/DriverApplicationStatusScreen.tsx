import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';

export function DriverApplicationStatusScreen() {
  const router = useRouter();
  const application = useAuthStore((state) => state.driverApplication);
  const restartDriverApplication = useAuthStore((state) => state.restartDriverApplication);
  const setRole = useAuthStore((state) => state.setRole);
  const refreshDriverApplication = useAuthStore((state) => state.refreshDriverApplication);

  useEffect(() => { void refreshDriverApplication(); const interval=setInterval(()=>void refreshDriverApplication(),15000); return()=>clearInterval(interval); }, [refreshDriverApplication]);

  if (!application || application.status === 'draft') return <Redirect href="/driver-onboarding" />;

  const config = {
    pending: { icon: '◷', tone: 'warning' as const, surface: 'bg-warningSoft', title: 'Application under review', detail: 'We’re checking your personal, vehicle, and document information. Most reviews are completed within 1–3 business days.' },
    approved: { icon: '✓', tone: 'success' as const, surface: 'bg-successSoft', title: 'You’re approved to drive', detail: 'Your driver account is ready. Switch to driver mode to start receiving trip requests.' },
    rejected: { icon: '!', tone: 'danger' as const, surface: 'bg-dangerSoft', title: 'Application needs attention', detail: application.rejectionReason ?? 'One or more details could not be verified. Review your information and submit again.' },
  }[application.status];

  return <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
    <View className="flex-row items-center px-lg py-sm"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.replace('/home')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3" className="!text-[22px]">←</Text></Pressable><Text variant="bodyMedium" className="ml-md">Driver application</Text></View>
    <View className="flex-1 justify-center px-xl"><View className={`rounded-[24px] p-xl ${config.surface}`}><View className="h-16 w-16 items-center justify-center rounded-full bg-surface"><Text variant="h2" color={config.tone}>{config.icon}</Text></View><Text variant="h2" className="mt-xl !text-[28px]">{config.title}</Text><Text color="textMuted" className="mt-sm">{config.detail}</Text><View className="mt-xl rounded-xl bg-surface p-lg"><StatusRow label="Personal information" complete /><StatusRow label="Vehicle information" complete /><StatusRow label="Required documents" complete /><StatusRow label="Review decision" complete={application.status !== 'pending'} /></View></View>
      {application.status === 'pending' ? <View className="mt-lg rounded-xl border border-border p-md"><Text variant="bodyMedium">What happens next?</Text><Text variant="caption" color="textMuted" className="mt-xs">We’ll notify you when the review is complete. You can continue booking rides as a rider while you wait.</Text></View> : null}
    </View>
    <View className="px-xl">{application.status === 'approved' ? <Button label="Go to driver dashboard" fullWidth size="lg" onPress={() => { void setRole('driver').then((changed)=>changed&&router.replace('/driver-dashboard')); }} /> : application.status === 'rejected' ? <Button label="Review and resubmit" fullWidth size="lg" onPress={() => { restartDriverApplication(); router.replace('/driver-onboarding'); }} /> : <Button label="Continue as rider" variant="outline" fullWidth size="lg" onPress={() => router.replace('/home')} />}<SafeAreaView edges={['bottom']} className="h-lg" /></View>
  </SafeAreaView>;
}

function StatusRow({ label, complete }: { label: string; complete: boolean }) {
  return <View className="flex-row items-center border-b border-border py-sm"><View className={`h-6 w-6 items-center justify-center rounded-full ${complete ? 'bg-successSoft' : 'bg-warningSoft'}`}><Text variant="caption" color={complete ? 'success' : 'warning'}>{complete ? '✓' : '…'}</Text></View><Text variant="caption" className="ml-sm flex-1">{label}</Text></View>;
}
