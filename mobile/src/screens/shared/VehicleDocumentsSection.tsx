import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from '@/components/common';
import { getDriverApplicationStatus, type DriverApplicationResponse } from '@/services/driverService';
import { apiErrorMessage } from '@/lib/apiClient';

/** The applicant sees their own submitted metadata; private file paths stay on the API. */
export function VehicleDocumentsSection() {
  const router = useRouter();
  const [data, setData] = useState<DriverApplicationResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getDriverApplicationStatus().then(value => { if (active) setData(value); })
      .catch(reason => { if (active) setError(apiErrorMessage(reason)); });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <View><Text color="danger">{error}</Text><Button label="Reload vehicle details" variant="outline" onPress={() => { setError(''); setAttempt(value => value + 1); }} /></View>;
  if (!data) return <Text color="textMuted">Loading your submitted vehicle and documents…</Text>;
  const vehicle = data.vehicle;
  return <View className="gap-lg">
    <View className="rounded-xl bg-surfaceMuted p-lg">
      <Text variant="h3">{vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'No vehicle submitted'}</Text>
      {vehicle ? <Text color="textMuted" className="mt-sm">{[vehicle.color, vehicle.year, vehicle.registrationNumber].filter(Boolean).join(' · ')}</Text> : null}
      <Text variant="caption" className="mt-sm">Application: {data.status} · Category: {data.serviceSettings.vehicleCategory ?? 'Awaiting classification'}</Text>
    </View>
    <Text variant="bodyMedium">Submitted documents</Text>
    {(data.documents ?? []).map(document => <View key={document.kind} className="rounded-xl border border-border p-md">
      <Text variant="bodyMedium">{document.kind === 'license' ? 'Driving licence' : document.kind === 'registration' ? 'Vehicle registration' : 'Insurance'}</Text>
      <Text variant="caption" color={document.available ? 'textMuted' : 'warning'}>{document.available ? 'Uploaded with your application' : 'Not uploaded'}</Text>
    </View>)}
    <Text variant="caption" color="textMuted">Upload status does not establish document validity or expiry. Staff review passenger and courier eligibility separately. Contact support to change previously reviewed vehicle details or documents.</Text>
    <Button label="View application status" variant="outline" onPress={() => router.push('/driver-status')} />
    <Button label="Manage service applications" variant="outline" onPress={() => router.push('/driver-onboarding')} />
    <Button label="Contact support about documents" variant="ghost" onPress={() => router.push('/account/support')} />
  </View>;
}
