import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { RideIcon } from './RideIcon';
import { DriverServicesView } from './DriverServiceManagement';
import { useAuthStore } from '@/store/authStore';
import { apiErrorMessage } from '@/lib/apiClient';
import type { DriverService, DriverServiceSettings } from '@/services/driverService';
import { useTripStore } from '@/store/tripStore';
import { getSocket, SOCKET_EVENTS } from '@/services/socket';
import { useTheme } from '@/constants/theme';
import { driverServiceAvailable, driverServiceEnabled } from '@/utils/driverServices';

export { DriverServicesView } from './DriverServiceManagement';

export function DriverServiceSettingsBootstrap() {
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role);
  const refresh = useAuthStore(state => state.refreshDriverApplication);
  useEffect(() => {
    if (!userId) return;
    const reload = () => { void refresh().then(()=>{const current=useAuthStore.getState().driverServices,offer=useTripStore.getState().offer;if(current&&offer&&!driverServiceEnabled(current,offer.serviceType??'ride'))useTripStore.getState().setOffer(null);}).catch(() => {}); };
    const socket = getSocket();
    reload();
    socket.on('connect', reload);
    socket.on(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS, reload);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') reload(); });
    return () => { socket.off('connect', reload); socket.off(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS, reload); listener.remove(); };
  }, [userId, role, refresh]);
  return null;
}

export function DriverServicePreferences({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const settings = useAuthStore(state => state.driverServices);
  const refresh = useAuthStore(state => state.refreshDriverServices);
  const save = useAuthStore(state => state.saveDriverServicePreferences);
  const withdrawConsent = useAuthStore(state => state.withdrawDriverServiceConsent);
  const [withdrawing, setWithdrawing] = useState<DriverService | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { void refresh().catch(() => setError('Could not load your services.')); }, [refresh]);
  const toggle = async (service: DriverService) => {
    const current = useAuthStore.getState().driverServices;
    if (!current || inFlight.current || !driverServiceAvailable(current, service)) return;
    inFlight.current = true;
    setSaving(true); setError(null); setNotice('');
    try { await save(service === 'ride' ? !driverServiceEnabled(current, 'ride') : driverServiceEnabled(current, 'ride'), service === 'courier' ? !driverServiceEnabled(current, 'courier') : driverServiceEnabled(current, 'courier')); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const reload = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try { await refresh(); setError(null); }
    catch { setError('Could not load your services.'); }
    finally { inFlight.current = false; setRefreshing(false); }
  };
  const withdraw = async () => {
    if (!withdrawing || inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError(null);
    try {
      await withdrawConsent(withdrawing);
      setNotice(`${withdrawing === 'ride' ? 'Passenger' : 'Courier'} consent withdrawn. New requests are off.`);
      setWithdrawing(null);
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <DriverServicesView compact={compact} settings={settings} saving={saving} refreshing={refreshing} error={error} notice={notice} expanded={expanded} withdrawing={withdrawing}
    onManage={() => { if (!inFlight.current) setExpanded(value => !value); }} onToggle={service => void toggle(service)} onReload={() => void reload()} onApplications={service => { if (inFlight.current) return; setExpanded(false); router.push({ pathname: '/driver-onboarding', params: service ? { service } : {} }); }}
    onWithdrawStart={service => { if (inFlight.current || !useAuthStore.getState().driverServices?.services[service].consentAccepted) return; setError(null); setWithdrawing(service); }} onWithdrawCancel={() => { if (!inFlight.current) setWithdrawing(null); }} onWithdrawConfirm={() => void withdraw()} />;
}

interface ChoiceProps {
  category: 'car' | 'motorcycle' | null;
  services: DriverService[];
  onChange: (category: 'car' | 'motorcycle', services: DriverService[]) => void;
  allowed?: DriverService[];
  lockedCategory?: boolean;
  disabled?: boolean;
  layout?: 'default' | 'onboarding';
}

export function DriverServiceChoices({ category, services, onChange, allowed = ['ride', 'courier'], lockedCategory = false, disabled = false, layout = 'default' }: ChoiceProps) {
  const { colors } = useTheme();
  const onboarding = layout === 'onboarding';
  const choices: { title: string; detail: string; services: DriverService[] }[] = [
    { title: 'Passenger rides', detail: 'Take passengers in your approved car.', services: ['ride'] },
    { title: 'Courier deliveries', detail: 'Deliver packages by car or motorcycle.', services: ['courier'] },
    { title: 'Both services', detail: 'Passenger rides and courier deliveries.', services: ['ride', 'courier'] },
  ];
  return (
    <View style={choiceStyles.section}>
      <Text variant={onboarding ? 'button' : 'bodyMedium'}>{lockedCategory ? 'Your registered vehicle' : onboarding ? 'Your vehicle type' : 'Choose your vehicle first'}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Vehicle type" style={choiceStyles.vehicleOptions}>
        {(['car', 'motorcycle'] as const).filter(value => !lockedCategory || value === category).map(value => {
          const selected = category === value;
          const unavailable = disabled || (lockedCategory && !selected);
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === 'car' ? 'Car' : 'Motorcycle'} accessibilityState={{ checked: selected, disabled: unavailable }} aria-checked={selected} disabled={unavailable}
              onPress={() => onChange(value, category === value ? services : value === 'motorcycle' ? ['courier'] : [])}
              style={[choiceStyles.vehicleCard, onboarding && choiceStyles.onboardingVehicle, { borderColor: selected ? colors.primary : onboarding ? colors.border : colors.borderStrong, backgroundColor: selected ? colors.primarySoft : colors.surface, opacity: unavailable ? 0.5 : 1 }]}
            >
              <View style={choiceStyles.vehicleHeading}>
                {onboarding ? <><RideIcon name={value === 'car' ? 'vehicle' : 'motorcycle'} size={24} color={selected ? 'primary' : 'icon'} /><ChoiceIndicator selected={selected} /></> : <Text variant="bodyMedium" color={selected ? 'primary' : 'text'}>{selected ? '✓ ' : ''}{value === 'car' ? 'Car' : 'Motorcycle'}</Text>}
              </View>
              {onboarding ? <Text variant="button">{value === 'car' ? 'Car' : 'Motorcycle'}</Text> : <Text variant="caption" color="textMuted">{value === 'car' ? 'Rides & deliveries' : 'Deliveries only'}</Text>}
            </Pressable>
          );
        })}
      </View>
      {(!onboarding || lockedCategory) ? <Text variant="caption" color="textMuted">One vehicle per account. {lockedCategory ? 'Contact support to request a vehicle replacement.' : 'The same vehicle and documents cover all your services.'}</Text> : null}
      {category ? <><Text variant={onboarding ? 'button' : 'bodyMedium'} style={choiceStyles.workLabel}>What would you like to do?</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Driver services" style={choiceStyles.serviceOptions}>
        {choices.filter(choice => choice.services.every(service => allowed.includes(service)) && (category !== 'motorcycle' || !choice.services.includes('ride'))).map(choice => {
          const selected = choice.services.length === services.length && choice.services.every(service => services.includes(service));
          return (
            <Pressable key={choice.title} accessibilityRole="radio" accessibilityLabel={choice.title} accessibilityState={{ checked: selected, disabled: disabled || !category }} aria-checked={selected} disabled={disabled || !category} onPress={() => category && onChange(category, choice.services)}
              style={[choiceStyles.serviceCard, onboarding && choiceStyles.onboardingService, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, opacity: disabled || !category ? 0.6 : 1 }]}
            >
              {onboarding ? <View style={choiceStyles.serviceIcon}>{choice.services.length === 2 ? <View style={choiceStyles.bothIcons}><RideIcon name="passenger" size={18} color={selected ? 'primary' : 'icon'} /><RideIcon name="package" size={18} color={selected ? 'primary' : 'icon'} /></View> : <RideIcon name={choice.services[0] === 'ride' ? 'passenger' : 'package'} size={24} color={selected ? 'primary' : 'icon'} />}</View> : null}
              <View style={choiceStyles.serviceCopy}>
                <Text variant={onboarding ? 'button' : 'bodyMedium'} color={!onboarding && selected ? 'primary' : 'text'}>{choice.title}</Text>
                <Text variant="caption" color="textMuted">{choice.detail}</Text>
              </View>
              <ChoiceIndicator selected={selected} />
            </Pressable>
          );
        })}
      </View>
      {(!onboarding || category === 'motorcycle') ? <Text variant="caption" color="textMuted">{category === 'motorcycle' ? 'Motorcycles are eligible for courier deliveries only.' : 'After approval, choose which requests you receive.'}</Text> : null}</> : null}
    </View>
  );
}

function ChoiceIndicator({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return <View style={[choiceStyles.indicator, { borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primary : colors.background }]}>{selected ? <Text variant="caption" color="textInverse">✓</Text> : null}</View>;
}

export function DriverServiceConsent({ settings, services, accepted, onChange, disabled = false }: { settings: DriverServiceSettings; services: DriverService[]; accepted: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={choiceStyles.section}>
      {services.map(service => <Text key={service} variant="caption" color="textMuted">{settings.consent.descriptions[service]}</Text>)}
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Accept service selection consent" accessibilityState={{ checked: accepted, disabled }} aria-checked={accepted} disabled={disabled} onPress={() => onChange(!accepted)} style={[choiceStyles.consent, { backgroundColor: colors.surfaceMuted, borderColor: accepted ? colors.primary : colors.border }]}>
        <View style={[choiceStyles.checkbox, { borderColor: accepted ? colors.primary : colors.borderStrong, backgroundColor: accepted ? colors.primary : colors.background }]}>{accepted ? <Text variant="caption" color="textInverse">✓</Text> : null}</View>
        <Text variant="caption" style={choiceStyles.serviceCopy}>I choose these services and understand the request preferences above.</Text>
      </Pressable>
    </View>
  );
}

const choiceStyles = StyleSheet.create({
  section: { gap: 12 },
  vehicleOptions: { flexDirection: 'row', gap: 12 },
  vehicleCard: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 },
  vehicleHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' },
  workLabel: { marginTop: 8 },
  serviceOptions: { gap: 12 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, minHeight: 80 },
  serviceCopy: { flex: 1, gap: 5 },
  onboardingVehicle: { borderRadius: 12, minHeight: 80, gap: 8 },
  onboardingService: { borderRadius: 12, padding: 14, minHeight: 78 },
  serviceIcon: { width: 28, alignItems: 'center' },
  bothIcons: { flexDirection: 'row', gap: 2 },
  indicator: { width: 22, height: 22, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderWidth: 1, borderRadius: 16 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

export { DriverServiceEnrollmentScreen } from '@/screens/driver/DriverServiceEnrollmentScreen';
