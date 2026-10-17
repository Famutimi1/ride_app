import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { apiErrorMessage } from '@/lib/apiClient';
import { getSupportSettings, type SupportSettings } from '@/services/careService';

export function SupportSection() {
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef({ generation: 0 });
  const refresh = useCallback(() => {
    const current = ++request.current.generation;
    return getSupportSettings().then((value) => {
      if (request.current.generation === current) { setSettings(value); setError(null); }
    }, (reason: unknown) => {
      if (request.current.generation === current) setError(apiErrorMessage(reason));
    }).finally(() => { if (request.current.generation === current) setLoading(false); });
  }, []);
  useEffect(() => {
    void refresh();
    const control = request.current;
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') { setLoading(true); void refresh(); } });
    return () => { control.generation++; listener.remove(); };
  }, [refresh]);
  const open = async (url: string) => {
    try { await Linking.openURL(url); }
    catch { setError('Could not open your phone or email app. Use the contact details shown below.'); }
  };
  return <>
    <Text variant="h3">Contact Rakky Ride</Text>
    {settings ? <View className="mt-md rounded-xl bg-surfaceMuted p-md">
      <Text>{settings.availabilityMessage}</Text>
      <Text variant="caption" color="textMuted" className="mt-sm">{settings.staffedHours}</Text>
      {settings.phone ? <Text className="mt-md">{settings.phone}</Text> : null}
      {settings.email ? <Text className="mt-sm">{settings.email}</Text> : null}
    </View> : loading ? <Text color="textMuted" className="mt-md">Loading support details…</Text> : null}
    {error ? <Text color="danger" className="mt-md">{error}</Text> : null}
    {settings?.phone ? <Button label="Call support" fullWidth className="mt-lg" onPress={() => { void open(`tel:${settings.phone}`); }} /> : null}
    {settings?.email ? <Button label="Email support" variant="outline" fullWidth className="mt-sm" onPress={() => { void open(`mailto:${settings.email}`); }} /> : null}
    <Button label="Refresh support details" variant="outline" fullWidth loading={loading} className="mt-md" onPress={() => { setLoading(true); void refresh(); }} />
  </>;
}
