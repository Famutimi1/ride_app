import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the real mobile controls and eligibility policy with controlled I/O.
// Types stay local so the backend compiler does not emit mobile source files.
type Service = 'ride' | 'courier';
interface Settings {
  version: number; vehicleCategory: 'car' | 'motorcycle' | null;
  vehicle: { make: string; model: string; year: number; color: string; registrationNumber: string };
  services: Record<Service, { status: string; enabled: boolean; consentAccepted: boolean; review: null }>;
  consent: { version: string; descriptions: Record<Service, string> };
}
type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => unknown); props: Props }
interface Policy {
  driverVehicleServices: (category: Settings['vehicleCategory']) => Service[];
  driverServiceAvailable: (settings: Settings, service: Service) => boolean;
  driverServiceEnabled: (settings: Settings, service: Service) => boolean;
}
const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
const jsx = (type: Element['type'], props: Props): Element => ({ type, props });
function load<T>(path: string, mocks: Record<string, unknown> = {}): T {
  const exports: Props = {};
  const code = compiler.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { fileName: path, compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { const feedbackModule = mobileFeedbackDependency(name); if (feedbackModule) return feedbackModule;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected mobile dependency ${name}`);
  } });
  return exports as T;
}
const policy = load<Policy>('utils/driverServices.ts');
const applicationPolicy = load('utils/driverApplications.ts', { './driverServices': policy });
const fixture = (category: Settings['vehicleCategory'] = 'car'): Settings => ({
  version: 2, vehicleCategory: category,
  vehicle: { make: 'Test', model: 'Vehicle', year: 2020, color: 'Silver', registrationNumber: 'TEST-123' },
  services: { ride: { status: 'approved', enabled: true, consentAccepted: true, review: null }, courier: { status: 'approved', enabled: true, consentAccepted: true, review: null } },
  consent: { version: 'fixture', descriptions: { ride: 'Ride terms', courier: 'Courier terms' } },
});
const react = { useEffect: () => undefined, useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => undefined] };
const native = { View: 'View', Pressable: 'Pressable', Modal: 'Modal', ScrollView: 'ScrollView', Switch: 'Switch', Platform: { OS: 'web' }, ActivityIndicator: 'ActivityIndicator', useWindowDimensions: () => ({ width: 405 }), StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
const theme = { useTheme: () => ({ colors: {}, scheme: 'light' }), nativeWindTheme: { light: {} }, radius: {}, spacing: {} };
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const element = root as Element;
  return [element, ...elements(typeof element.type === 'function' ? element.type(element.props) : element.props.children)];
}
const labels = (root: unknown) => elements(root).map(item => item.props.accessibilityLabel).filter(Boolean);
function choicesModule(auth: object = {}) {
  return load<{ DriverServiceChoices: (props: Props) => Element; DriverServicePreferences: (props: Props) => Element }>('components/common/DriverServiceSettings.tsx', {
    react, 'react-native': native, 'expo-router': { useRouter: () => ({}) }, './Text': { Text: 'Text' }, './RideIcon': { RideIcon: 'RideIcon' }, './DriverServiceManagement': { DriverServicesView: 'DriverServicesView' },
    '@/store/authStore': { useAuthStore: Object.assign((select: (state: object) => unknown) => select(auth), { getState: () => auth }) },
    '@/store/tripStore': {}, '@/services/socket': {}, '@/lib/apiClient': { apiErrorMessage: (error: Error) => error.message }, '@/constants/theme': theme,
    '@/utils/driverServices': policy, '@/screens/driver/DriverServiceEnrollmentScreen': {},
  });
}

test('vehicle choice comes first; motorcycles select courier and car accounts can choose either or both', () => {
  const { DriverServiceChoices } = choicesModule();
  for (const layout of ['default', 'onboarding']) {
    let selected: unknown;
    const props = { layout, category: null, services: [], onChange: (...args: unknown[]) => { selected = args; } };
    const first = DriverServiceChoices(props);
    assert.equal(labels(first).includes('Driver services'), false);
    const bike = elements(first).find(item => item.props.accessibilityLabel === 'Motorcycle')!;
    (bike.props.onPress as () => void)();
    assert.deepEqual(JSON.parse(JSON.stringify(selected)), ['motorcycle', ['courier']]);
    const motorcycle = labels(DriverServiceChoices({ ...props, category: 'motorcycle', services: ['courier'] }));
    assert.ok(motorcycle.includes('Courier deliveries'));
    assert.equal(motorcycle.includes('Passenger rides'), false); assert.equal(motorcycle.includes('Both services'), false);
    const car = labels(DriverServiceChoices({ ...props, category: 'car' }));
    assert.ok(['Passenger rides', 'Courier deliveries', 'Both services'].every(label => car.includes(label)));
    assert.equal(labels(DriverServiceChoices({ ...props, category: 'car', lockedCategory: true })).includes('Motorcycle'), false);
  }
});

test('an additional service uses the registered vehicle without another vehicle picker or document form', () => {
  const view = load<{ DriverServiceEnrollmentView: (props: Props) => Element }>('screens/driver/DriverApplicationsView.tsx', {
    react, 'react-native': native, 'expo-image': { Image: 'Image' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/common': { Text: 'Text' }, '@/components/common/RideIcon': { RideIcon: 'RideIcon' }, '@/components/map/AddressIcon': { AddressIcon: 'AddressIcon' },
    '@/components/common/DriverVehicleSummary': { DriverVehicleSummary: 'DriverVehicleSummary' }, '@/constants/theme': theme,
    '@/utils/driverServices': policy, '@/utils/driverApplications': applicationPolicy,
  });
  for (const category of ['car', 'motorcycle'] as const) {
    const settings = fixture(category); settings.services.courier = { status: 'none', enabled: false, consentAccepted: false, review: null };
    const root = view.DriverServiceEnrollmentView({ settings, loading: false, busy: false, submitted: false });
    const tree = elements(root), summary = tree.find(item => item.type === 'DriverVehicleSummary');
    assert.equal(summary?.props.settings, settings);
    assert.equal(labels(root).includes('Vehicle type'), false);
    assert.ok(labels(root).includes('Courier deliveries'));
    assert.equal(tree.some(item => item.type === 'Input' || item.type === 'DocumentField'), false);
  }
});

test('vehicle eligibility fails closed for old or inconsistent service settings', () => {
  for (const category of ['car', 'motorcycle', null] as const) {
    const value = fixture(category);
    assert.equal(policy.driverServiceEnabled(value, 'ride'), category === 'car');
    assert.equal(policy.driverServiceEnabled(value, 'courier'), category !== null);
  }
  const value = fixture(); value.services.courier.status = 'pending';
  assert.equal(policy.driverServiceAvailable(value, 'courier'), false);
});

test('motorcycle preference controls cannot send a passenger preference even with stale flags', async () => {
  const calls: boolean[][] = [];
  const settings = fixture('motorcycle');
  const screen = choicesModule({ driverServices: settings, saveDriverServicePreferences: async (...args: boolean[]) => { calls.push(args); } });
  const view = screen.DriverServicePreferences({});
  const toggle = view.props.onToggle as (service: Service) => void;
  toggle('ride'); assert.equal(calls.length, 0);
  toggle('courier'); await new Promise(done => setImmediate(done));
  assert.deepEqual(calls, [[false, false]]);
});

test('a motorcycle account never displays a stale passenger offer', () => {
  const settings = fixture('motorcycle');
  let serviceType: Service = 'ride';
  const screen = load<{ RideOfferOverlay: () => Element }>('components/notifications/RideOfferOverlay.tsx', {
    react, 'react-native': native, 'expo-router': { useRouter: () => ({}) }, '@/components/common': { Text: 'Text', Button: 'Button' }, '@/constants/theme': theme,
    '@/utils/driverServices': policy,
    '@/store/authStore': { useAuthStore: (select: (state: object) => unknown) => select({ session: { user: { role: 'driver' } }, driverApplication: { status: 'approved' }, driverServices: settings }) },
    '@/store/tripStore': { useTripStore: (select: (state: object) => unknown) => select({ offer: { tripId: 'trip', serviceType, expiresAt: '2026-10-21T10:00:00Z', pickup: {}, dropoff: {} } }) },
  });
  assert.equal(screen.RideOfferOverlay().props.visible, false);
  serviceType = 'courier'; assert.equal(screen.RideOfferOverlay().props.visible, true);
});
