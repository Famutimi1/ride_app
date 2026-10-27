import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
interface MapCoordinate { latitude: number; longitude: number }
interface MapLocation extends MapCoordinate { address: string; placeId?: string }
interface CourierDraft { description: string; weightKg: number; recipientName: string; recipientPhone: string; pickupInstructions: string; dropoffInstructions: string; acceptedRestrictions: boolean }
interface Trip {
  id: string; rider_id: string; driver_id: string | null; status: string; service_type: 'ride' | 'courier'; vehicle_type: string;
  courier_details?: Omit<CourierDraft, 'acceptedRestrictions'> | null;
  pickup_lat: number; pickup_lng: number; pickup_address: string; pickup_place_id?: string;
  dropoff_lat: number; dropoff_lng: number; dropoff_address: string; dropoff_place_id?: string;
  estimated_distance_m: number; estimated_duration_s: number; fare_kobo: number; payment_method: string; requested_at: string; route_polyline?: string;
}

const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
const { createStore } = mobileRequire('zustand/vanilla') as { createStore: (initializer: unknown) => unknown };
type Props = Record<string, unknown>;
interface Element { type: string; props: Props }
interface DraftStore { getState: () => { draft: CourierDraft | null; setDraft: (draft: CourierDraft) => void; clearDraft: () => void } }
interface MapState {
  pickupLocation: MapLocation | null; dropoffLocation: MapLocation | null; routeCoordinates: MapCoordinate[];
  cameraRegion: unknown; clearTripMap: () => void;
  setPickupLocation: (value: MapLocation | null) => void; setDropoffLocation: (value: MapLocation | null) => void;
}
interface MapStore { getState: () => MapState }
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
const react = {
  useEffect: () => undefined,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => undefined],
};
const rn = { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', Share: {}, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
const details = { description: 'Documents', weightKg: 1.5, recipientName: 'Test recipient', recipientPhone: '+2348000000000', pickupInstructions: 'Front desk', dropoffInstructions: 'Reception' };
const fixture = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'failed-courier', rider_id: 'rider', driver_id: null, status: 'no_drivers_found', service_type: 'courier', vehicle_type: 'courier', courier_details: details,
  pickup_lat: 6.4, pickup_lng: 3.4, pickup_address: 'Original pickup', pickup_place_id: 'pickup-place',
  dropoff_lat: 6.5, dropoff_lng: 3.5, dropoff_address: 'Original drop-off', dropoff_place_id: 'dropoff-place',
  estimated_distance_m: 1200, estimated_duration_s: 600, fare_kobo: 200000, payment_method: 'wallet', requested_at: '2026-10-21T12:00:00Z',
  route_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', ...overrides,
});

function harness(trip = fixture()) {
  const draft = load<{ useCourierDraftStore: DraftStore }>('store/courierDraftStore.ts', { zustand: { create: createStore } }).useCourierDraftStore;
  const map = load<{ useMapStore: MapStore }>('store/mapStore.ts', { zustand: { create: createStore } }).useMapStore;
  const polyline = load('utils/polyline.ts');
  const retry = load<{ prepareTripRetry: (trip: Trip, changePickup?: boolean) => unknown }>('utils/tripRetry.ts', {
    '@/store/courierDraftStore': { useCourierDraftStore: draft }, '@/store/mapStore': { useMapStore: map }, '@/utils/polyline': polyline,
  });
  let current: Trip | null = trip;
  const routes: unknown[] = [];
  const events: string[] = [];
  const requestCalls: { input: Props; key: string }[] = [];
  const store = {
    trip: current as Trip | null, driverLocation: null, loading: false,
    clear: () => { events.push(draft.getState().draft ? 'clear-after-restore' : 'clear'); current = null; },
    request: async (input: Props, key: string) => { requestCalls.push({ input, key }); return fixture({ id: 'new-courier', status: 'searching' }); },
  };
  const selectMap = (select: (state: MapState) => unknown) => select(map.getState());
  const selectDraft = (select: (state: ReturnType<DraftStore['getState']>) => unknown) => select(draft.getState());
  const router = { replace: (target: unknown) => routes.push(target), push: (target: unknown) => routes.push(target) };
  const ongoing = load<{ OngoingTripScreen: () => Element }>('screens/rider/OngoingTripScreen.tsx', {
    react, 'react-native': rn, 'expo-router': { useRouter: () => router, Redirect: 'Redirect' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/map': {}, '@/components/common': {}, '@/constants/theme': { useTheme: () => ({ colors: {} }) },
    '@/store/mapStore': { useMapStore: selectMap }, '@/store/tripStore': { useTripStore: (select: (state: typeof store) => unknown) => select({ ...store, trip: current }) },
    '@/hooks/useLiveDriverTracking': { useLiveDriverTracking: () => undefined }, '@/hooks/useTripMapRoute': { useTripMapRoute: () => ({ primary: [], secondary: [] }) },
    '@/services/tripService': {}, '@/lib/apiClient': {}, './DriverSearchView': {}, './NoDriversFoundView': { NoDriversFoundView: 'NoDriversFoundView' },
    '@/components/communication/TripCallOptions':{}, '@/utils/tripCamera': {activeTripRegion:()=>undefined}, '@/utils/tripRetry': retry, '@/components/trip/TripCancellationModal': {},
  });
  const review = () => load<{ CourierReviewScreen: () => Element }>('screens/rider/CourierReviewScreen.tsx', {
    react, 'react-native': rn, 'expo-image': { Image: 'Image' }, 'expo-router': { useRouter: () => router }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/map': { AppMap: 'AppMap' }, '@/components/common': { Text: 'Text', Button: 'Button' }, '@/components/map/AddressIcon': {}, '@/components/common/RideIcon': {},
    '@/constants/theme': { useTheme: () => ({ colors: {} }), radius: {}, spacing: {}, borderWidths:{divider:1} }, '@/lib/apiClient': { apiErrorMessage: (error: Error) => error.message },
    '@/store/courierDraftStore': { useCourierDraftStore: selectDraft }, '@/store/mapStore': { useMapStore: selectMap },
    '@/store/tripStore': { useTripStore: (select: (state: typeof store) => unknown) => select(store) },
    '@/store/walletStore': { useWalletStore: (select: (state: Props) => unknown) => select({ walletKobo: 1000000, refresh: async () => undefined }) },
    '@/services/tripService': { TripQuoteError: class extends Error {} },
    '@/hooks/useTripQuote': { useTripQuote: () => ({ estimate: { fareKobo: 200000 }, ensureFresh: async () => ({ fareKobo: 200000, quoteId: 'fresh-courier-quote' }), clearFareChange: () => undefined }) },
    '@/services/paymentService': { formatNaira: (value: number) => `NGN ${value / 100}` },
    '@/assets/images/home-v2/courier.png': 1,
  }).CourierReviewScreen();
  return { draft, map, retry, ongoing, routes, events, current: () => current, review, requestCalls };
}
function invoke(element: Element, name: string) { (element.props[name] as () => void)(); }
function elements(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(elements);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const element = root as Element;
  return [element, ...elements(element.props.children)];
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('courier retry restores parcel and addresses before clearing and returns to courier review', () => {
  const h = harness();
  h.map.getState().setPickupLocation({ latitude: 1, longitude: 1, address: 'Unrelated pickup' });
  const screen = h.ongoing.OngoingTripScreen(); assert.equal(screen.type, 'NoDriversFoundView');
  invoke(screen, 'onRetry');
  assert.deepEqual(plain(h.draft.getState().draft), { ...details, acceptedRestrictions: true });
  assert.equal(h.map.getState().pickupLocation?.address, 'Original pickup');
  assert.equal(h.map.getState().dropoffLocation?.placeId, 'dropoff-place');
  assert.equal(h.map.getState().routeCoordinates.length, 5);
  assert.deepEqual(h.events, ['clear-after-restore']); assert.equal(h.current(), null);
  assert.deepEqual(h.routes, ['/courier-review']); assert.equal(h.requestCalls.length, 0);
});

test('changing pickup on a failed courier request retains the courier service and parcel', () => {
  const h = harness(); invoke(h.ongoing.OngoingTripScreen(), 'onChangePickup');
  assert.deepEqual(plain(h.routes), [{ pathname: '/set-destination', params: { service: 'courier' } }]);
  assert.equal(h.draft.getState().draft?.recipientPhone, details.recipientPhone);
  assert.equal(h.map.getState().dropoffLocation?.address, 'Original drop-off');
});

test('ordinary ride retry and pickup change keep the ride flow', () => {
  for (const [action, target] of [['onRetry', '/ride-selection'], ['onChangePickup', '/set-destination']]) {
    const h = harness(fixture({ service_type: 'ride', courier_details: null }));
    invoke(h.ongoing.OngoingTripScreen(), action);
    assert.deepEqual(h.routes, [target]); assert.equal(h.draft.getState().draft, null);
  }
});

test('missing courier details returns to the courier form rather than car rides or a stale parcel', () => {
  const h = harness(fixture({ courier_details: null }));
  h.draft.getState().setDraft({ ...details, description: 'Unrelated parcel', acceptedRestrictions: true });
  invoke(h.ongoing.OngoingTripScreen(), 'onRetry');
  assert.deepEqual(plain(h.routes), [{ pathname: '/courier', params: { retry: '1' } }]);
  assert.equal(h.draft.getState().draft, null); assert.equal(h.map.getState().dropoffLocation?.address, 'Original drop-off');
});

test('active or completed trips cannot be retried through the failed-search helper', () => {
  const h = harness();
  for (const status of ['searching', 'driver_assigned', 'in_progress', 'completed'] as const) assert.throws(() => h.retry.prepareTripRetry(fixture({ status })), /unsuccessful/);
  assert.equal(h.draft.getState().draft, null); assert.equal(h.map.getState().pickupLocation, null);
});

test('retry review submits courier details with a fresh quote and no old handoff code', async () => {
  const h = harness(); invoke(h.ongoing.OngoingTripScreen(), 'onRetry');
  assert.equal(h.requestCalls.length, 0, 'opening retry never auto-books');
  const button = elements(h.review()).find(element => element.type === 'Button' && String(element.props.label).startsWith('Send package'));
  assert.ok(button); assert.equal(button.props.disabled, false); invoke(button, 'onPress');
  await new Promise(done => setImmediate(done));
  assert.equal(h.requestCalls.length, 1);
  const { input, key } = h.requestCalls[0];
  assert.equal(input.serviceType, 'courier'); assert.equal(input.paymentMethod, 'wallet'); assert.equal(input.quoteId, 'fresh-courier-quote');
  assert.deepEqual(plain(input.courierDetails), { ...details, acceptedRestrictions: true });
  assert.equal((input.pickup as MapLocation).address, 'Original pickup'); assert.equal((input.dropoff as MapLocation).address, 'Original drop-off');
  assert.match(key, /^courier-/); assert.equal('deliveryCode' in input, false); assert.equal('tripId' in input, false);
  assert.equal(h.draft.getState().draft, null, 'submitted draft clears normally and can be restored from a later failed trip');
  assert.equal(h.routes.at(-1), '/ongoing-trip');
});

test('the courier fallback form preserves restored endpoints until the user chooses addresses', () => {
  for (const params of [{ retry: '1' }, {}]) {
    const effects: Array<() => void> = [];
    let cleared = false;
    const form = load<{ CourierScreen: () => Element }>('screens/rider/CourierScreen.tsx', {
      react: { ...react, useEffect: (effect: () => void) => effects.push(effect) },
      'react-native': { ...rn, KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' } },
      'expo-image': { Image: 'Image' }, 'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => params },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@/components/common': { Text: 'Text', Input: 'Input', Button: 'Button' },
      '@/components/map/AddressIcon': {}, '@/components/common/RideIcon': {},
      '@/constants/theme': { useTheme: () => ({ colors: {}, scheme: 'light' }), nativeWindTheme: { light: {} }, typography: {}, spacing: {}, radius: {} },
      '@/store/courierDraftStore': { useCourierDraftStore: (select: (state: Props) => unknown) => select({ draft: null, setDraft: () => undefined }) },
      '@/store/mapStore': { useMapStore: { getState: () => ({ clearTripMap: () => { cleared = true; } }) } }, '@/assets/images/home-v2/courier.png': 1,
    });
    form.CourierScreen(); effects.forEach(effect => effect());
    assert.equal(cleared, !('retry' in params));
  }
});
