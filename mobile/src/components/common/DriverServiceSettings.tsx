import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, Switch, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Text } from './Text';
import { useAuthStore } from '@/store/authStore';
import { apiErrorMessage } from '@/lib/apiClient';
import { applyForDriverServices, getDriverServiceSettings, type DriverService, type DriverServiceSettings } from '@/services/driverService';
import { useTripStore } from '@/store/tripStore';
import { getSocket, SOCKET_EVENTS } from '@/services/socket';
import { nativeWindTheme, useTheme } from '@/constants/theme';

export function DriverServiceSettingsBootstrap() {
  const userId = useAuthStore(state => state.session?.user.id);
  const refresh = useAuthStore(state => state.refreshDriverApplication);
  useEffect(() => {
    if (!userId) return;
    const reload = () => { void refresh().then(()=>{const current=useAuthStore.getState().driverServices,offer=useTripStore.getState().offer;if(current&&offer&&!current.services[offer.serviceType??'ride'].enabled)useTripStore.getState().setOffer(null);}).catch(() => {}); };
    const socket = getSocket();
    reload();
    socket.on('connect', reload);
    socket.on(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS, reload);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    return () => { socket.off('connect', reload); socket.off(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS, reload); listener.remove(); };
  }, [userId, refresh]);
  return null;
}

export function DriverServicePreferences() {
  const router = useRouter();
  const theme = useTheme();
  const wide = useWindowDimensions().width >= 700;
  const settings = useAuthStore(state => state.driverServices);
  const refresh = useAuthStore(state => state.refreshDriverServices);
  const save = useAuthStore(state => state.saveDriverServicePreferences);
  const withdrawConsent = useAuthStore(state => state.withdrawDriverServiceConsent);
  const [withdrawing, setWithdrawing] = useState<DriverService | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void refresh().catch(() => setError('Could not load your services.')); }, [refresh]);
  const toggle = async (service: DriverService) => {
    if (!settings || saving || refreshing) return;
    setSaving(true); setError(null);
    try { await save(service === 'ride' ? !settings.services.ride.enabled : settings.services.ride.enabled, service === 'courier' ? !settings.services.courier.enabled : settings.services.courier.enabled); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setSaving(false); }
  };
  const ride = settings?.services.ride.enabled;
  const courier = settings?.services.courier.enabled;
  const mode = ride && courier ? 'Rides and deliveries' : ride ? 'Passenger rides only' : courier ? 'Courier deliveries only' : 'Not accepting requests';
  const reload = async () => {
    setRefreshing(true);
    try { await refresh(); setError(null); }
    catch { setError('Could not load your services.'); }
    finally { setRefreshing(false); }
  };
  const withdraw = async () => {
    if (!withdrawing || saving) return;
    setSaving(true); setError(null);
    try {
      await withdrawConsent(withdrawing);
      setNotice(`${withdrawing === 'ride' ? 'Passenger' : 'Courier'} consent withdrawn. New requests are off.`);
      setWithdrawing(null);
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setSaving(false); }
  };
  return <View className="mt-md rounded-xl border border-border p-md">
    <Text variant="bodyMedium">Your services</Text><Text variant="caption" color="textMuted" className="mt-xs">{settings ? mode : 'Loading services…'}</Text>
    <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }} className="mt-md">
    {settings ? (['ride', 'courier'] as const).map(service => {
      const state = settings.services[service];
      const available = state.status === 'approved' && state.consentAccepted;
      return <View key={service} style={{ flex: wide ? 1 : undefined, minWidth: 0 }} className="rounded-xl bg-surfaceMuted p-md">
        <View className="flex-row items-center justify-between gap-md">
          <View className="flex-1"><Text variant="bodyMedium">{service === 'ride' ? 'Passenger rides' : 'Courier deliveries'}</Text>
            <Text variant="caption" color={state.status === 'suspended' || state.status === 'rejected' ? 'danger' : state.status === 'approved' ? 'success' : 'textMuted'}>{state.status === 'none' ? 'Not requested' : state.status === 'pending' ? 'Under review' : state.status === 'approved' ? 'Approved' : state.status === 'suspended' ? 'Suspended' : 'Rejected'} · Requests {state.enabled ? 'on' : 'off'}</Text>
          </View>
          <View className="min-h-[48px] justify-center"><Switch accessibilityLabel={service === 'ride' ? 'Receive passenger ride requests' : 'Receive courier requests'} value={state.enabled} disabled={saving || refreshing || !available} onValueChange={() => void toggle(service)} trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }} thumbColor={theme.colors.surface} /></View>
        </View>
        <Text variant="caption" color="textMuted" className="mt-sm">{state.status === 'suspended' ? 'New requests are blocked until staff restore this service. Restored requests stay off until you enable them.' : state.status === 'approved' && !state.consentAccepted ? 'Service consent required' : state.status === 'none' ? 'Apply to provide this service' : state.status === 'approved' ? 'Choose whether to receive new requests.' : state.status === 'pending' ? 'We will update this status when your review is complete.' : 'Review the decision and submit a new application.'}</Text>
        {state.review?.reason ? <Text variant="caption" color="textMuted" className="mt-sm">Review reason: {state.review.reason}</Text> : null}
        {state.consentAccepted ? <Button label={`Withdraw ${service === 'ride' ? 'passenger' : 'courier'} consent`} variant="ghost" disabled={saving || refreshing} onPress={() => { setError(null); setWithdrawing(service); }} /> : null}
      </View>;
    }) : null}
    </View>
    <Text variant="caption" color="textMuted" className="mt-md">These choices affect new requests. Finish any job you have already accepted.</Text>
    {notice ? <Text variant="caption" accessibilityLiveRegion="polite" color="success" className="mt-sm">{notice}</Text> : null}
    {error ? <><Text variant="caption" color="danger" className="mt-sm">{error}</Text><Button label="Reload services" variant="ghost" onPress={() => void refresh().then(() => setError(null)).catch(() => setError('Could not load your services.'))} /></> : null}
    <Button label="Refresh service status" variant="ghost" loading={refreshing} disabled={saving} onPress={() => void reload()} />
    <Button label="Manage service applications" variant="ghost" disabled={saving} onPress={() => router.push('/driver-onboarding')} />
    <Modal visible={withdrawing !== null} transparent animationType="fade" onRequestClose={() => { if (!saving) setWithdrawing(null); }}>
      <View style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]} className="flex-1 items-center justify-center p-lg">
        <View accessibilityViewIsModal style={{ maxWidth: 560, maxHeight: '85%' }} className="w-full rounded-2xl bg-surface p-xl">
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text variant="h3">Withdraw {withdrawing === 'ride' ? 'passenger' : 'courier'} consent?</Text>
            <Text className="mt-md">This stops new requests for this service. To receive them again, explicitly select the service and accept its consent in Manage service applications.</Text>
            <Text color="textMuted" className="mt-sm">For a temporary break, cancel and turn requests off instead. An accepted job still needs to be completed.</Text>
            {error ? <Text color="danger" className="mt-md">{error}</Text> : null}
            <Button label="Withdraw consent" variant="destructive" loading={saving} className="mt-lg" onPress={() => void withdraw()} />
            <Button label="Keep consent" variant="outline" disabled={saving} className="mt-sm" onPress={() => setWithdrawing(null)} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

interface ChoiceProps {
  category: 'car' | 'motorcycle' | null;
  services: DriverService[];
  onChange: (category: 'car' | 'motorcycle', services: DriverService[]) => void;
  allowed?: DriverService[];
  lockedCategory?: boolean;
}

export function DriverServiceChoices({ category, services, onChange, allowed = ['ride', 'courier'], lockedCategory = false }: ChoiceProps) {
  const choices: { title: string; detail: string; services: DriverService[] }[] = [
    { title: 'Passenger rides', detail: 'Take passengers in your approved car.', services: ['ride'] },
    { title: 'Courier deliveries', detail: 'Deliver sealed packages using your car or motorcycle.', services: ['courier'] },
    { title: 'Both services', detail: 'Apply for both. Choose which requests you receive after approval.', services: ['ride', 'courier'] },
  ];
  return <View className="gap-md">
    <Text variant="bodyMedium">Which vehicle will you use?</Text>
    <View className="flex-row gap-md">{(['car', 'motorcycle'] as const).map(value => <View key={value} className="flex-1"><Button label={value === 'car' ? 'Car' : 'Motorcycle'} variant={category === value ? 'primary' : 'outline'} disabled={lockedCategory && category !== value} onPress={() => onChange(value, value === 'motorcycle' ? ['courier'] : [])} /></View>)}</View>
    <Text variant="bodyMedium" className="mt-md">What work would you like to do?</Text>
    {choices.filter(choice => choice.services.every(service => allowed.includes(service)) && (category !== 'motorcycle' || !choice.services.includes('ride'))).map(choice => {
      const selected = choice.services.length === services.length && choice.services.every(service => services.includes(service));
      return <Pressable key={choice.title} accessibilityRole="radio" accessibilityState={{ checked: selected }} disabled={!category} onPress={() => category && onChange(category, choice.services)} className={`rounded-xl border p-lg ${selected ? 'border-primary bg-primarySoft' : 'border-border bg-surface'} ${!category ? 'opacity-60' : ''}`}><Text variant="bodyMedium" color={selected ? 'primary' : 'text'}>{selected ? '✓ ' : ''}{choice.title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{choice.detail}</Text></Pressable>;
    })}
    {category === 'motorcycle' ? <Text variant="caption" color="textMuted">Motorcycles provide courier deliveries only.</Text> : null}
  </View>;
}

export function DriverServiceConsent({ settings, services, accepted, onChange }: { settings: DriverServiceSettings; services: DriverService[]; accepted: boolean; onChange: (value: boolean) => void }) {
  return <View className="gap-sm">
    {services.map(service => <Text key={service} variant="caption" color="textMuted">{settings.consent.descriptions[service]}</Text>)}
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} onPress={() => onChange(!accepted)} className="flex-row items-center rounded-xl bg-surfaceMuted p-md"><Text color={accepted ? 'primary' : 'text'}>{accepted ? '☑' : '☐'}</Text><Text variant="caption" className="ml-sm flex-1">I choose these services and understand the request preferences above.</Text></Pressable>
  </View>;
}

/** Approved partners add services here without repeating registration or material uploads. */
export function DriverServiceEnrollmentScreen() {
  const router = useRouter();
  const refresh = useAuthStore(state => state.refreshDriverServices);
  const [settings, setSettings] = useState<DriverServiceSettings | null>(null);
  const [category, setCategory] = useState<'car' | 'motorcycle' | null>(null);
  const [services, setServices] = useState<DriverService[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const load = () => getDriverServiceSettings().then(value => { setSettings(value); setCategory(value.vehicleCategory); });
  useEffect(() => { void load().catch(() => setError('Could not load service applications.')); }, []);
  const allowed = (['ride', 'courier'] as const).filter(service => settings && (settings.services[service].status !== 'pending'||!settings.services[service].consentAccepted) && settings.services[service].status !== 'suspended' && (settings.services[service].status !== 'approved' || !settings.services[service].consentAccepted));
  const hasApproval=settings&&(['ride','courier'] as const).some(service=>settings.services[service].status==='approved');
  const submit = async () => {
    if (!settings || !category || !services.length || !accepted) return;
    setBusy(true); setError(null);
    try {
      await applyForDriverServices({ services, vehicleCategory: category, consentVersion: settings.consent.version, consentAccepted: true, expectedVersion: settings.version });
      await refresh(); await load(); setSubmitted(true);
    } catch (reason) { setError(apiErrorMessage(reason)); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  return <SafeAreaView className="flex-1 bg-background"><ScrollView contentContainerClassName="p-xl gap-lg">
    <Text variant="h2">Your service applications</Text>
    <Text color="textMuted">{hasApproval?'Your existing approved service stays available while we review another service.':'Complete your service selection so we can review the work you want to provide.'}</Text>
    {settings ? (['ride', 'courier'] as const).map(service => <View key={service} className="rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">{service === 'ride' ? 'Passenger rides' : 'Courier deliveries'} · {settings.services[service].status}</Text>{settings.services[service].review?.reason ? <Text variant="caption" color="textMuted">{settings.services[service].review?.reason}</Text> : null}</View>) : null}
    {submitted ? <Text color="success">Your selection was saved. New services require approval before you can enable requests.</Text> : settings && allowed.length ? <>
      <DriverServiceChoices category={category} services={services} allowed={allowed} lockedCategory={settings.vehicleCategory !== null} onChange={(vehicle, selected) => { setCategory(vehicle); setServices(selected); setAccepted(false); }} />
      {services.length ? <DriverServiceConsent settings={settings} services={services} accepted={accepted} onChange={setAccepted} /> : null}
      <Button label="Submit service selection" loading={busy} disabled={!category || !services.length || !accepted} onPress={() => void submit()} />
    </> : settings ? <Text color="textMuted">There are no additional services available to apply for right now.</Text> : null}
    {error ? <><Text color="danger">{error}</Text><Button label="Reload" variant="outline" onPress={() => void load().catch(() => setError('Could not load service applications.'))} /></> : null}
    <Button label={hasApproval?'Back to dashboard':'Back to application status'} variant="outline" onPress={() => router.replace(hasApproval?'/driver-dashboard':'/driver-status')} />
  </ScrollView></SafeAreaView>;
}
