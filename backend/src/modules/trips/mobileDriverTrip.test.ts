import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Actual mobile components and store, with controlled I/O: no live trip or payment changes.
const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props }
interface Trip extends Props { id: string; driver_id: string | null; rider_id: string; status: string; service_type: string; payment_method: string }
interface State { trip: Trip | null; loading: boolean; error: string | null; complete: (code?: string) => Promise<void> }
interface Store { getState: () => State; setState: (value: Partial<State>) => void }
const { createStore } = mobileRequire('zustand/vanilla') as { createStore: (initializer: unknown) => Store };
const jsx = (type: string, props: Props): Element => ({ type, props });
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
function hooks() {
  const state: unknown[] = []; let cursor = 0;
  return { reset: () => { cursor = 0; }, react: {
    useMemo: (fn: () => unknown) => fn(),
    useRef: (value: unknown) => { const index = cursor++; state[index] ??= { current: value }; return state[index]; },
    useState: (value: unknown) => { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], (next: unknown) => { state[index] = next; }]; },
  } };
}
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as Element;
  if (typeof node.type === 'function') return elements(node.type(node.props));
  return [node, ...elements(node.props.children)];
}
function button(tree: Element, label: string): Element {
  const node = elements(tree).find(item => item.props.label === label || item.props.accessibilityLabel === label);
  assert.ok(node, `Missing button ${label}`); return node;
}
function press(node: Element) { (node.props.onPress as () => void)(); }
const tick = () => new Promise(done => setImmediate(done));
const fixture = (overrides: Partial<Trip> = {}): Trip => ({ id: 'trip', rider_id: 'rider', driver_id: 'driver', status: 'in_progress', service_type: 'ride', payment_method: 'cash', fare_kobo: 250000, pickup_address: 'Pickup', dropoff_address: 'Destination', ...overrides });
const rn = { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ height: 804, width: 405 }) };
const shared = {
  'react-native': rn, '@/components/common': { Button: 'Button', Input: 'Input', Text: 'Text', Avatar: 'Avatar' },
  '@/components/common/RideIcon': { RideIcon: 'RideIcon' }, '@/constants/theme': { useTheme: () => ({ colors: {}, typography: {}, scheme: 'light' }), nativeWindTheme: { light: {} } },
  '@/lib/apiClient': { apiErrorMessage: (error: unknown) => (mobileFeedbackDependency('@/utils/userMessage') as { userErrorMessage: (value: unknown) => string }).userErrorMessage(error) }, '@/services/paymentService': { formatNaira: (amount: number) => `NGN ${amount / 100}` },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
};
function harness(trip = fixture()) {
  const calls: { id: string; code?: string }[] = [];
  const actions: string[] = [];
  let respond = async (): Promise<Trip> => ({ ...trip, status: trip.status === 'returning' ? 'returned' : 'completed' });
  const { useTripStore: store } = load<{ useTripStore: Store }>('store/tripStore.ts', {
    zustand: { create: createStore }, '@/utils/roleAccess': load('utils/roleAccess.ts'),
    '@/store/authStore': { useAuthStore: { getState: () => ({ session: { user: { id: 'driver', role: 'driver' } } }) } },
    '@/lib/apiClient': shared['@/lib/apiClient'], '@/services/tripService': {
      TripQuoteError: class extends Error {}, completeTrip: async (id: string, code?: string) => { calls.push({ id, code }); return respond(); },
      driverArrived: async () => { actions.push('arrived'); return { ...trip, status: 'driver_arrived' }; },
      startTrip: async () => { actions.push('start'); return { ...trip, status: 'in_progress' }; },
      cancelTrip: async () => { actions.push('cancel'); return { ...trip, status: 'cancelled' }; },
      returnCourierDelivery: async () => { actions.push('return'); return { ...trip, status: 'returning' }; },
    },
  });
  store.setState({ trip });
  const screenHooks = hooks();
  const screen = load<{ DriverTripScreen: () => Element }>('screens/driver/DriverTripScreen.tsx', {
    ...shared, '@/components/communication/TripCallOptions': {TripCallOptions:'TripCallOptions'}, react: screenHooks.react, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({ replace: () => undefined, push: () => undefined }) },
    '@/components/map': { AppMap: 'AppMap' }, '@/components/map/AddressIcon': { AddressIcon: 'AddressIcon' }, '@/components/trip/DriverTripConfirmation': { DriverTripConfirmation: 'DriverTripConfirmation' },
    '@/hooks/useTripMapRoute': { useTripMapRoute: () => ({ primary: [], secondary: [] }) }, '@/utils/tripCamera': load('utils/tripCamera.ts'),
    '@/store/tripStore': { useTripStore: (select: (state: State) => unknown) => select(store.getState()) },
    '@/store/mapStore': { useMapStore: (select: (state: Props) => unknown) => select({ currentLocation: { latitude: 6.4, longitude: 3.4 }, cameraRegion: {} }) },
  });
  const render = () => { screenHooks.reset(); return screen.DriverTripScreen(); };
  const open = () => {
    press(button(render(), trip.service_type === 'courier' ? trip.status === 'returning' ? 'Confirm return' : 'Confirm delivery' : 'Complete trip'));
    const node = elements(render()).find(item => item.type === 'DriverTripConfirmation'); assert.ok(node);
    const dialogHooks = hooks();
    const component = load<{ DriverTripConfirmation: (props: Props) => Element }>('components/trip/DriverTripConfirmation.tsx', { ...shared, react: dialogHooks.react });
    return () => { dialogHooks.reset(); return component.DriverTripConfirmation(node.props); };
  };
  return { store, calls, actions, render, open, respond: (fn: typeof respond) => { respond = fn; } };
}

test('web Complete trip opens a real dialog; Not yet keeps the trip unchanged', () => {
  const h = harness(); const dialog = h.open();
  assert.equal(h.calls.length, 0); assert.ok(elements(dialog()).some(node => node.type === 'Modal'));
  press(button(dialog(), 'Not yet'));
  assert.equal(h.calls.length, 0); assert.equal(h.store.getState().trip?.status, 'in_progress');
  assert.equal(elements(h.render()).some(node => node.type === 'DriverTripConfirmation'), false);
});

test('confirmation calls completion once and redirects only after server success', async () => {
  const h = harness(); let finish!: (trip: Trip) => void;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  const dialog = h.open(); const confirm = button(dialog(), 'Complete trip');
  press(confirm); press(confirm); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.store.getState().trip?.status, 'in_progress');
  assert.equal(h.render().type, 'View');
  finish(fixture({ status: 'completed' })); await tick();
  assert.equal(h.render().type, 'Redirect'); assert.equal(h.render().props.href, '/trip-complete');
});

test('failed completion stays in the dialog, shows an error and allows retry', async () => {
  const h = harness(); h.respond(async () => { throw new Error('Connection unavailable'); });
  const dialog = h.open(); press(button(dialog(), 'Complete trip')); await tick();
  assert.ok(elements(dialog()).some(node => node.props.children === 'We couldn’t complete that. Please try again.'));
  assert.equal(h.store.getState().trip?.status, 'in_progress'); assert.equal(h.render().type, 'View');
  h.respond(async () => fixture({ status: 'completed' })); press(button(dialog(), 'Complete trip')); await tick();
  assert.equal(h.calls.length, 2); assert.equal(h.render().props.href, '/trip-complete');
});

test('courier delivery and return require a code and send it to completion', async () => {
  for (const status of ['in_progress', 'returning']) {
    const h = harness(fixture({ service_type: 'courier', status })); const dialog = h.open();
    const label = status === 'returning' ? 'Confirm return' : 'Confirm delivery';
    press(button(dialog(), label)); await tick(); assert.equal(h.calls.length, 0);
    const input = elements(dialog()).find(node => node.type === 'Input'); assert.ok(input);
    (input.props.onChangeText as (value: string) => void)('123456'); press(button(dialog(), label)); await tick();
    assert.equal(h.calls[0].code, '123456'); assert.equal(h.calls[0].id, 'trip');
    assert.equal(h.store.getState().trip?.status, status === 'returning' ? 'returned' : 'completed');
  }
});

test('primary action stays outside scrolling details and active map retains close follow', () => {
  const h = harness(); const tree = h.render();
  const scroll = elements(tree).find(node => node.type === 'ScrollView'); assert.ok(scroll);
  assert.equal(elements(scroll).some(node => node.props.label === 'Complete trip'), false);
  const map = elements(tree).find(node => node.type === 'AppMap'); assert.ok(map);
  assert.equal(map.props.fitRouteOnChange, false);
  const region = map.props.region as { longitudeDelta: number };
  assert.equal(Math.round(Math.log2(360 / region.longitudeDelta)), 19);
  press(button(tree, 'View full trip route'));
  assert.equal(elements(h.render()).find(node => node.type === 'AppMap')?.props.fitRouteOnChange, true);
});

test('pickup actions still use the arrived and start endpoints for passengers and courier', async () => {
  for (const service_type of ['ride', 'courier']) {
    const h = harness(fixture({ status: 'driver_assigned', service_type }));
    press(button(h.render(), 'I have arrived')); await tick();
    assert.equal(h.store.getState().trip?.status, 'driver_arrived');
    press(button(h.render(), service_type === 'courier' ? 'Package collected' : 'Start trip')); await tick();
    assert.equal(h.store.getState().trip?.status, 'in_progress');
    assert.deepEqual(h.actions, ['arrived', 'start']); assert.equal(h.calls.length, 0);
  }
});
