import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as {
  transpileModule: (source: string, options: object) => { outputText: string };
  ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number };
};
type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props }
interface Content {
  safetyTitle: string; supportTitle: string; tips: { text: string }[];
  shortcuts: { destination: string; label: string }[];
  safetyArticles: { id: string; question: string; answer: string }[]; answers: { id: string; question: string; answer: string }[];
}
interface SampleTrip extends Props { id: string; rider_id: string; driver_id: string | null; status: string; service_type: string }
const fixture = (overrides: Props = {}): SampleTrip => ({
  id: 'trip-fixture', rider_id: 'rider', driver_id: 'driver', status: 'in_progress', service_type: 'ride',
  pickup_address: 'Private pickup', dropoff_address: 'Private destination', rider_name: 'Private rider', driver_name: 'Driver',
  vehicle_make: 'Example', vehicle_model: 'Car', plate_number: 'TEST', pickup_lat: 1.2345,
  courier_details: { recipientPhone: 'private-phone', packageDescription: 'private-contents' }, deliveryCode: 'private-code', ...overrides,
});
interface Helpers {
  careTripForRole: (trip: SampleTrip | null, userId: string | undefined, role: string) => SampleTrip | null;
  careServiceContext: (settings: Props | null, trip: SampleTrip | null) => { passenger: boolean; courier: boolean };
  careDestination: (destination: string, role: string, trip: SampleTrip | null) => unknown;
  supportContactUrl: (action: string, value: string, role: string, safety: boolean) => string;
}
const modules: Record<string, unknown> = {};
function load<T>(path: string, overrides: Record<string, unknown> = {}): T {
  const exports: Record<string, unknown> = {};
  const code = compiler.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX } }).outputText;
  const sources = { ...modules, ...overrides };
  runInNewContext(code, { exports, require: (name: string) => { const feedbackModule = mobileFeedbackDependency(name); if (feedbackModule) return feedbackModule; if (name in sources) return sources[name]; throw new Error(`Unexpected import ${name}`); }, setInterval: () => 0, clearInterval: () => undefined });
  return exports as T;
}
const safety = load<{ safetyTripShareMessage: (trip: SampleTrip | null, role?: string) => string | null }>('utils/safetyCenter.ts');
modules['./safetyCenter'] = modules['@/utils/safetyCenter'] = safety;
const helpers = load<Helpers>('utils/careCenter.ts'); modules['@/utils/careCenter'] = helpers;
modules['./driver'] = load('constants/care/driver.ts'); modules['./rider'] = load('constants/care/rider.ts');
const content = load<{ getCareContent: (role: string, context: { passenger: boolean; courier: boolean }) => Content }>('constants/care/index.ts');
modules['@/constants/care'] = content;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const settings = (ride: string, courier: string): Props => ({ services: { ride: { status: ride, consentAccepted: false }, courier: { status: courier, consentAccepted: false } } });

test('rider and driver safety/support have independent content and destinations', () => {
  const rider = content.getCareContent('rider', { passenger: true, courier: false });
  const driver = content.getCareContent('driver', { passenger: true, courier: false });
  assert.equal(driver.safetyTitle, 'Driver safety'); assert.equal(rider.safetyTitle, 'Rider safety');
  assert.ok(rider.tips.some(item => item.text.includes('Match the driver')));
  assert.ok(!driver.tips.some(item => item.text.includes('Match the driver')));
  assert.ok(driver.shortcuts.some(item => item.destination === 'vehicle-documents'));
  assert.ok(driver.shortcuts.some(item => item.destination === 'driver-services'));
  assert.ok(driver.answers.some(item => item.id === 'earnings'));
  assert.ok(driver.answers.some(item => item.id === 'pickup'));
  assert.ok(!driver.answers.some(item => item.id === 'hold' || item.id === 'lost-item'));
  assert.ok(!rider.shortcuts.some(item => ['vehicle-documents', 'driver-services', 'application'].includes(item.destination)));
  assert.ok(!rider.answers.some(item => item.id === 'payout' || item.id === 'earnings'));
});

test('courier help follows actual approval/current work, and courier-only drivers do not get passenger articles', () => {
  const car = content.getCareContent('driver', helpers.careServiceContext(settings('approved', 'none'), null));
  assert.ok(!car.answers.some(item => item.id === 'courier'));
  const courier = content.getCareContent('driver', helpers.careServiceContext(settings('none', 'approved'), null));
  assert.ok(courier.answers.some(item => item.id === 'courier'));
  assert.ok(courier.safetyArticles.some(item => item.id === 'courier-safety'));
  assert.ok(!courier.answers.some(item => item.id === 'pickup'));
  assert.ok(!courier.safetyArticles.some(item => item.id === 'passenger-safety'));
  assert.equal(helpers.careServiceContext(null, fixture({ service_type: 'courier' })).courier, true);
  assert.equal(helpers.careServiceContext(settings('none', 'pending'), null).courier, false);
  assert.equal(helpers.careServiceContext(settings('none', 'suspended'), null).courier, false);
});

test('only the active participant in the current mode can access/share a trip', () => {
  assert.ok(helpers.careTripForRole(fixture(), 'driver', 'driver'));
  assert.ok(helpers.careTripForRole(fixture(), 'rider', 'rider'));
  for (const [userId, role] of [['rider', 'driver'], ['driver', 'rider'], ['other', 'driver'], [undefined, 'rider']] as const) assert.equal(helpers.careTripForRole(fixture(), userId, role), null);
  for (const status of ['scheduled', 'completed', 'returned', 'cancelled', 'no_drivers_found']) assert.equal(helpers.careTripForRole(fixture({ status }), 'driver', 'driver'), null);
  assert.equal(helpers.careTripForRole(null, 'driver', 'driver'), null);
});

test('driver sharing excludes passenger routes, identity, package details, handoff codes and precise location', () => {
  const message = safety.safetyTripShareMessage(fixture(), 'driver')!;
  assert.match(message, /Trip reference: trip-fixture/); assert.match(message, /Vehicle: Example Car/);
  for (const privateValue of ['Private pickup', 'Private destination', 'Private rider', 'private-phone', 'private-contents', 'private-code', '1.2345']) assert.ok(!message.includes(privateValue));
  assert.doesNotMatch(message, /live tracking|https:/i);
  const rider = safety.safetyTripShareMessage(fixture())!;
  assert.match(rider, /Pickup: Private pickup/); assert.match(rider, /Driver: Driver/);
  assert.equal(safety.safetyTripShareMessage(fixture({ status: 'completed' }), 'driver'), null);
});

test('care navigation separates payments/history and targets existing driver management pages', () => {
  assert.deepEqual(plain(helpers.careDestination('wallet', 'driver', null)), { pathname: '/account/[section]', params: { section: 'driver-wallet' } });
  assert.deepEqual(plain(helpers.careDestination('wallet', 'rider', null)), { pathname: '/account/[section]', params: { section: 'payment' } });
  assert.deepEqual(plain(helpers.careDestination('history', 'driver', null)), { pathname: '/account/[section]', params: { section: 'driver-trips' } });
  assert.deepEqual(plain(helpers.careDestination('history', 'rider', null)), { pathname: '/account/[section]', params: { section: 'trips' } });
  assert.equal(helpers.careDestination('application', 'driver', null), '/driver-status');
  assert.equal(helpers.careDestination('trip', 'driver', fixture()), '/driver-trip');
  assert.equal(helpers.careDestination('trip', 'rider', fixture()), '/ongoing-trip');
  for (const section of ['vehicle-documents', 'driver-services']) assert.deepEqual(plain(helpers.careDestination(section, 'driver', null)), { pathname: '/account/[section]', params: { section } });
});

test('support composer identifies mode/topic without including personal data or sending messages', () => {
  assert.equal(helpers.supportContactUrl('phone', ' 01234 ', 'driver', false), 'tel:01234');
  const url = helpers.supportContactUrl('email', ' support@example.invalid ', 'driver', true);
  assert.match(url, /^mailto:support@example.invalid\?subject=/);
  assert.equal(new URL(url).searchParams.get('subject'), 'Rakky Ride driver safety concern');
  assert.equal(new URL(url).searchParams.get('body'), null);
  assert.match(decodeURIComponent(helpers.supportContactUrl('email', 'support@example.invalid', 'rider', false)), /Rakky Ride rider support/);
});

interface Slot { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: () => void }
let scope: Scope;
class Scope {
  slots: Slot[] = []; index = 0; pending: (() => void)[] = [];
  render<T>(work: () => T): T { const previous = scope; scope = this; this.index = 0; try { return work(); } finally { scope = previous; } }
  effects() { this.pending.splice(0).forEach(work => work()); }
  destroy() { this.slots.forEach(slot => slot.cleanup?.()); }
}
const equal = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
const react = {
  useState(initial: unknown) { const owner = scope, i = owner.index++; owner.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [owner.slots[i].value, (value: unknown) => { owner.slots[i].value = typeof value === 'function' ? value(owner.slots[i].value) : value; }]; },
  useRef(initial: unknown) { const owner = scope, i = owner.index++; return owner.slots[i] ??= { current: initial }; },
  useCallback(fn: unknown, deps: unknown[]) { const owner = scope, i = owner.index++; if (!equal(owner.slots[i]?.deps, deps)) owner.slots[i] = { value: fn, deps }; return owner.slots[i].value; },
  useMemo(fn: () => unknown) { return fn(); },
  useEffect(fn: () => (() => void) | void, deps: unknown[]) { const owner = scope, i = owner.index++; if (!equal(owner.slots[i]?.deps, deps)) { owner.slots[i]?.cleanup?.(); const slot: Slot = { deps }; owner.slots[i] = slot; owner.pending.push(() => { slot.cleanup = fn() ?? undefined; }); } },
};
const jsx = (type: Element['type'], props: Props): Element => ({ type, props });
const calls: unknown[][] = [];
const user = { id: 'driver', role: 'driver' };
const auth = { session: { user }, driverServices: settings('approved', 'approved') };
const authHook = Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth });
const trip = { trip: fixture() as SampleTrip | null };
const tripHook = Object.assign((selector: (state: typeof trip) => unknown) => selector(trip), { getState: () => trip });
let shareJob: Promise<unknown> | null = null;
modules.react = react; modules['react/jsx-runtime'] = { jsx, jsxs: jsx };
modules['react-native'] = { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', Platform: { OS: 'web' }, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, AppState: { addEventListener: () => ({ remove() {} }) },
  Linking: { openURL: async (url: string) => { calls.push(['link', url]); } }, Share: { share: async (value: unknown) => { calls.push(['share', value]); if (shareJob) await shareJob; } } };
modules['expo-router'] = { useRouter: () => ({ push: (value: unknown) => calls.push(['push', value]), replace: (value: unknown) => calls.push(['replace', value]), canGoBack: () => false }), useLocalSearchParams: () => ({ topic: 'safety' }) };
modules['react-native-safe-area-context'] = { SafeAreaView: 'SafeAreaView' };
modules['@/components/common'] = { Button: 'Button', Text: 'Text' }; modules['@/components/common/RideIcon'] = { RideIcon: 'Icon' }; modules['@/components/map/AddressIcon'] = { AddressIcon: 'Icon' };
modules['@/constants/theme'] = { spacing: {}, radius: {}, borderWidths: { divider: 1 }, useTheme: () => ({ colors: new Proxy({}, { get: (_target, key) => key }) }) };
modules['@/store/authStore'] = { useAuthStore: authHook }; modules['@/store/tripStore'] = { useTripStore: tripHook };
modules['@/services/careService'] = { getSupportSettings: async () => ({ phone: '01234', email: 'support@example.invalid', availabilityMessage: 'Sample availability', staffedHours: '' }) };
const safetyScreen = load<{ SafetyCenterScreen: () => Element; SafetyCenterView: (props: Props) => Element }>('screens/shared/SafetyCenterScreen.tsx');
const supportScreen = load<{ HelpSupportScreen: () => Element; HelpSupportView: (props: Props) => Element }>('screens/shared/HelpSupportScreen.tsx');
function controller(component: () => Element) { const wrapper = new Scope().render(component); const owner = new Scope(); const render = () => owner.render(() => (wrapper.type as (props: Props) => Element)(wrapper.props)); render(); owner.effects(); return { render, owner }; }
const invoke = (props: Props, name: string, ...args: unknown[]) => (props[name] as (...input: unknown[]) => void)(...args);
const flush = () => new Promise<void>(done => setImmediate(done));
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  if (typeof element.type === 'function') return [element, ...nodes(new Scope().render(() => (element.type as (props: Props) => Element)(element.props)))];
  return [element, ...nodes(element.props.children)];
}
const text = (list: Element[]) => list.map(node => typeof node.props.children === 'string' ? node.props.children : '').join(' ');

test('driver safety removes rider-only tools and keeps inactive sharing disabled', () => {
  const owner = new Scope();
  const list = nodes(owner.render(() => safetyScreen.SafetyCenterView({ role: 'driver', content: content.getCareContent('driver', { passenger: true, courier: false }), activeTrip: false, calling: null, sharing: false, browser: true, onTrip() {}, onShare() {}, onCall() {}, onSupport() {}, onBack() {} })));
  assert.ok(!text(list).includes('Trusted contacts')); assert.ok(!text(list).includes('Match the driver'));
  assert.equal(list.find(node => node.props.accessibilityLabel === 'Share trip details. Available during an active trip.')?.props.disabled, true);
  assert.ok(text(list).includes('Driver safety')); assert.ok(text(list).includes('Passenger behaviour or an unsafe pickup'));
});

test('safety sharing rechecks the current trip and mode and prevents duplicate shares', async () => {
  calls.length = 0; const c = controller(safetyScreen.SafetyCenterScreen);
  let done!: () => void; shareJob = new Promise<void>(resolve => { done = resolve; });
  const props = c.render().props; invoke(props, 'onShare'); invoke(props, 'onShare');
  assert.equal(calls.filter(call => call[0] === 'share').length, 1); done(); await flush(); shareJob = null;
  trip.trip = null; invoke(c.render().props, 'onShare'); assert.equal(calls.filter(call => call[0] === 'share').length, 1);
  trip.trip = fixture(); user.role = 'rider'; invoke(props, 'onShare'); invoke(props, 'onTrip');
  assert.equal(calls.filter(call => call[0] === 'share').length, 1); assert.equal(calls.filter(call => call[0] === 'push').length, 0);
  user.role = 'driver'; c.owner.destroy();
});

test('support controller protects active trip navigation and uses role-aware safety contact subject', async () => {
  calls.length = 0; trip.trip = null; const c = controller(supportScreen.HelpSupportScreen); await flush();
  const props = c.render().props; invoke(props, 'onNavigate', 'vehicle-documents');
  assert.deepEqual(plain(calls.at(-1)), ['push', { pathname: '/account/[section]', params: { section: 'vehicle-documents' } }]);
  trip.trip = fixture(); invoke(props, 'onNavigate', 'wallet'); assert.equal(calls.filter(call => call[0] === 'push').length, 1);
  invoke(props, 'onTrip'); assert.deepEqual(plain(calls.at(-1)), ['push', '/driver-trip']);
  invoke(props, 'onContact', 'email'); await flush(); assert.match(decodeURIComponent(String(calls.at(-1)?.[1])), /driver safety concern/);
  user.role = 'rider'; invoke(props, 'onContact', 'phone'); invoke(props, 'onNavigate', 'application'); await flush();
  assert.equal(calls.filter(call => call[0] === 'link').length, 1); assert.equal(calls.filter(call => call[0] === 'push').length, 2);
  user.role = 'driver'; trip.trip = fixture(); c.owner.destroy();
});

test('support view exposes operational topics and the actual contact options without a fake incident submission', () => {
  const c = new Scope();
  const list = nodes(c.render(() => supportScreen.HelpSupportView({ driver: true, safety: true, tripPresent: false, settings: null, loading: false, content: content.getCareContent('driver', { passenger: true, courier: true }), onNavigate() {} })));
  assert.ok(text(list).includes('Vehicle & documents')); assert.ok(text(list).includes('Services & request preferences'));
  assert.ok(text(list).includes('delivery code')); assert.ok(text(list).includes('Choose a contact option below'));
  assert.ok(!list.some(node => node.props.label === 'Submit report'));
  assert.ok(!text(list).includes('Call support')); assert.ok(!text(list).includes('Email support'));
});

test('driver active-trip safety is reachable without changing trip status', () => {
  calls.length = 0;
  const map = { cameraRegion: null, currentLocation: null };
  const { DriverTripScreen } = load<{ DriverTripScreen: () => Element }>('screens/driver/DriverTripScreen.tsx', {
    '@/components/trip/DriverTripConfirmation': { DriverTripConfirmation: 'Confirmation' },
    '@/services/paymentService': { formatNaira: (value: number) => `₦${value / 100}` },
    '@/components/communication/TripCallOptions': { TripCallOptions: 'TripCallOptions' },
    'react-native': { ...(modules['react-native'] as Record<string, unknown>), useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/lib/apiClient': { apiErrorMessage: () => 'Please try again.' },
    '@/utils/tripCamera': { activeTripRegion: () => null },
    '@/components/map': { AppMap: 'Map' }, '@/hooks/useTripMapRoute': { useTripMapRoute: () => ({ primary: [], secondary: [] }) },
    '@/store/mapStore': { useMapStore: (selector: (state: typeof map) => unknown) => selector(map) },
  });
  const list = nodes(new Scope().render(DriverTripScreen));
  const button = list.find(node => node.props.accessibilityLabel === 'Open driver safety');
  assert.ok(button); invoke(button.props, 'onPress');
  assert.deepEqual(plain(calls.at(-1)), ['push', { pathname: '/account/[section]', params: { section: 'safety' } }]);
  assert.equal(trip.trip?.status, 'in_progress');
});
