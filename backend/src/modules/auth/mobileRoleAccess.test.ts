import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Run the actual mobile policies, layout, hooks and stores with controlled I/O.
const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
const { createStore } = mobileRequire('zustand/vanilla') as { createStore: (initializer: unknown) => Store };
type Props = Record<string, unknown>;
interface Element { type: string; props: Props; key?: string }
interface User { id: string; role: 'rider' | 'driver' }
interface Trip { id: string; rider_id: string; driver_id: string | null; status: string }
interface State {
  trip: Trip | null; offer: Props | null; driverLocation: unknown;
  recover: () => Promise<Trip | null>; refreshCurrent: () => Promise<Trip | null>;
  request: (input: Props, key: string) => Promise<unknown>; acceptOffer: () => Promise<void>;
  arrived: () => Promise<void>; setOffer: (offer: Props | null) => void; clear: () => void;
}
interface Store { getState: () => State; setState: (state: Partial<State>) => void }
interface Policy {
  appRouteAccess: Record<string, string>; accountSectionAccess: Record<string, string>;
  appRouteRedirect: (path: string, role: string, status?: string, finishing?: boolean) => unknown;
  accountSectionRedirect: (section: string, role: string, status?: string) => unknown;
  tripBelongsToRole: (trip: Trip | null, userId: string | undefined, role: string) => boolean;
  canContactTrip: (trip: Trip | null, userId: string | undefined, role: string, requestedId?: string) => boolean;
}
const jsx = (type: string, props: Props, key?: string): Element => ({ type, props, key });
function load<T>(path: string, mocks: Record<string, unknown> = {}): T {
  const exports: Record<string, unknown> = {};
  const code = compiler.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { fileName: path, compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected mobile dependency ${name}`);
  } });
  return exports as T;
}
const policy = load<Policy>('utils/roleAccess.ts');
const fixture = (values: Partial<Trip> = {}): Trip => ({ id: 'trip', rider_id: 'rider', driver_id: 'driver', status: 'in_progress', ...values });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('every signed-in route and dynamic account section declares its audience', () => {
  const root = resolve('../mobile/src/app/(app)');
  const routes = readdirSync(root).filter(file => file.endsWith('.tsx') && file !== '_layout.tsx').map(file => file.replace('.tsx', ''));
  routes.push('account/[section]');
  assert.deepEqual(Object.keys(policy.appRouteAccess).sort(), routes.sort());
  const source = readFileSync(resolve('../mobile/src/screens/shared/AccountSectionScreen.tsx'), 'utf8');
  const declared = source.match(/type SectionId = ([^;]+);/)![1].match(/'([^']+)'/g)!.map(value => value.slice(1, -1));
  assert.deepEqual(Object.keys(policy.accountSectionAccess).sort(), declared.sort());
});

test('opposite-mode direct links are blocked even for an approved driver account', () => {
  for (const [path, audience] of Object.entries(policy.appRouteAccess)) {
    if (audience !== 'rider' && audience !== 'driver') continue;
    assert.equal(policy.appRouteRedirect(`/${path}`, audience, 'approved'), null);
    assert.equal(policy.appRouteRedirect(`/${path}`, audience === 'rider' ? 'driver' : 'rider', 'approved'), audience === 'rider' ? '/driver-dashboard' : '/home');
  }
  for (const [section, audience] of Object.entries(policy.accountSectionAccess)) {
    if (audience !== 'rider' && audience !== 'driver') continue;
    assert.equal(policy.accountSectionRedirect(section, audience, 'approved'), null);
    assert.equal(policy.appRouteRedirect(`/account/${section}`, audience === 'rider' ? 'driver' : 'rider', 'approved'), audience === 'rider' ? '/driver-dashboard' : '/home');
  }
});

test('applications remain reachable before approval; unknown paths fail closed', () => {
  for (const status of ['draft', 'pending', 'rejected', 'approved']) {
    for (const role of ['rider', 'driver']) {
      assert.equal(policy.appRouteRedirect('/driver-onboarding', role, status), null);
      assert.equal(policy.appRouteRedirect('/driver-status', role, status), null);
      assert.equal(policy.appRouteRedirect('/account/support', role, status), null);
      assert.equal(policy.appRouteRedirect('/account/settings', role, status), null);
    }
  }
  assert.equal(policy.appRouteRedirect('/driver-dashboard', 'driver', 'pending'), '/driver-status');
  assert.equal(policy.appRouteRedirect('/account/withdraw', 'driver', 'draft'), '/driver-onboarding');
  assert.equal(policy.appRouteRedirect('/constructor', 'rider', 'approved'), '/home');
  assert.equal(policy.appRouteRedirect('/account/toString', 'driver', 'approved'), '/driver-dashboard');
  assert.equal(policy.appRouteRedirect('/driver-trip', 'driver', 'rejected', true), null);
  assert.equal(policy.appRouteRedirect('/driver-trip', 'rider', 'approved', true), '/home');
});

test('the layout rejects a link before the screen mounts and resets shared screens on mode/account changes', () => {
  let pathname = '/account/withdraw';
  const auth = { session: { user: { id: 'account', role: 'rider' } }, driverApplication: { status: 'approved' } };
  const layout = load<{ default: () => Element }>('app/(app)/_layout.tsx', {
    'expo-router': { Redirect: 'Redirect', Stack: 'Stack', usePathname: () => pathname },
    '@/store/authStore': { useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) },
    '@/store/tripStore': { useTripStore: (select: (state: { trip: null }) => unknown) => select({ trip: null }) },
    '@/utils/roleAccess': policy,
  });
  assert.equal(layout.default().type, 'Redirect'); assert.equal(layout.default().props.href, '/home');
  pathname = '/account/profile';
  const rider = layout.default(); assert.equal(rider.type, 'Stack');
  auth.session.user.role = 'driver';
  const driver = layout.default(); assert.equal(driver.type, 'Stack'); assert.notEqual(driver.key, rider.key);
  auth.session.user.id = 'other'; assert.notEqual(layout.default().key, driver.key);
  pathname = '/schedule'; assert.equal(layout.default().props.href, '/driver-dashboard');
});

test('shared trip content requires ownership in the active role, and contact requires the actual active trip', () => {
  for (const [userId, role] of [['rider', 'rider'], ['driver', 'driver']]) assert.ok(policy.tripBelongsToRole(fixture(), userId, role));
  for (const [userId, role] of [['driver', 'rider'], ['rider', 'driver'], ['other', 'driver']]) assert.equal(policy.tripBelongsToRole(fixture(), userId, role), false);
  assert.equal(policy.canContactTrip(fixture(), 'driver', 'driver', 'other-trip'), false);
  assert.ok(policy.canContactTrip(fixture(), 'driver', 'driver', 'trip'));
  for (const status of ['scheduled', 'searching', 'completed', 'returned', 'cancelled']) assert.equal(policy.canContactTrip(fixture({ status }), 'driver', 'driver'), false);
  assert.equal(policy.canContactTrip(fixture({ driver_id: null }), 'rider', 'rider'), false);
});

function tripHarness(overrides: Record<string, unknown> = {}, initialRole: User['role'] = 'rider') {
  const auth: { session: { user: User } | null } = { session: { user: { id: initialRole, role: initialRole } } };
  const calls: string[] = [];
  const api = {
    getActiveTrip: async () => null, getCurrentOffer: async () => { calls.push('offer'); return { tripId: 'offered-trip' }; },
    getTrip: async () => fixture(), requestTrip: async () => { calls.push('request'); return { trip: fixture() }; },
    acceptTrip: async () => { calls.push('accept'); return fixture(); }, driverArrived: async () => { calls.push('arrived'); return fixture(); }, ...overrides,
  };
  const store = load<{ useTripStore: Store }>('store/tripStore.ts', {
    zustand: { create: createStore }, '@/lib/apiClient': { apiErrorMessage: (error: Error) => error.message },
    '@/services/tripService': { TripQuoteError: class extends Error {}, ...api },
    '@/store/authStore': { useAuthStore: { getState: () => auth } }, '@/utils/roleAccess': policy,
  }).useTripStore;
  return { auth, store, calls };
}

test('rider recovery never fetches or displays driver offers, including queued socket offers', async () => {
  const h = tripHarness(); await h.store.getState().recover();
  assert.equal(h.calls.length, 0); assert.equal(h.store.getState().offer, null);
  h.store.getState().setOffer({ tripId: 'stale-driver-offer' }); assert.equal(h.store.getState().offer, null);
  const driver = tripHarness({}, 'driver'); await driver.store.getState().recover();
  assert.equal(driver.calls[0], 'offer'); assert.equal(driver.store.getState().offer?.tripId, 'offered-trip');
});

test('late trip recovery cannot restore data after a mode switch or logout', async () => {
  for (const change of ['mode', 'logout']) {
    const pending = deferred<Trip | null>();
    const h = tripHarness({ getActiveTrip: () => pending.promise });
    const result = h.store.getState().recover();
    if (change === 'mode') h.auth.session = { user: { id: 'rider', role: 'driver' } }; else h.auth.session = null;
    h.store.getState().clear(); pending.resolve(fixture());
    await assert.rejects(result, /account or app mode changed/);
    assert.equal(h.store.getState().trip, null); assert.equal(h.store.getState().offer, null);
  }
});

test('recovered trips and refreshed details are rejected for the opposite participant role', async () => {
  const h = tripHarness({ getActiveTrip: async () => fixture({ rider_id: 'other', driver_id: 'rider' }) });
  await h.store.getState().recover(); assert.equal(h.store.getState().trip, null);
  h.store.setState({ trip: fixture() });
  const job = deferred<Trip>();
  const late = tripHarness({ getTrip: () => job.promise }); late.store.setState({ trip: fixture() });
  const read = late.store.getState().refreshCurrent();
  late.auth.session!.user = { id: 'rider', role: 'driver' };
  job.resolve(fixture()); assert.equal(await read, null);
});

test('trip actions reject the wrong mode before sending a request', async () => {
  const rider = tripHarness(); rider.store.setState({ trip: fixture(), offer: { tripId: 'offer' } });
  await assert.rejects(rider.store.getState().acceptOffer(), /correct mode/);
  await assert.rejects(rider.store.getState().arrived(), /correct mode/);
  assert.equal(rider.calls.length, 0);
  const driver = tripHarness({}, 'driver');
  await assert.rejects(driver.store.getState().request({}, 'key'), /correct mode/); assert.equal(driver.calls.length, 0);
});

interface Slot { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: () => void }
let scope: Scope;
class Scope {
  slots: Slot[] = []; index = 0; pending: (() => void)[] = [];
  render<T>(work: () => T): T { scope = this; this.index = 0; return work(); }
  effects() { this.pending.splice(0).forEach(work => work()); }
  destroy() { this.slots.forEach(slot => slot.cleanup?.()); }
}
const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
const react = {
  useState(initial: unknown) { const owner = scope, i = owner.index++; owner.slots[i] ??= { value: initial }; return [owner.slots[i].value, (value: unknown) => { owner.slots[i].value = typeof value === 'function' ? value(owner.slots[i].value) : value; }]; },
  useRef(initial: unknown) { const owner = scope, i = owner.index++; return owner.slots[i] ??= { current: initial }; },
  useCallback(fn: unknown, deps: unknown[]) { const owner = scope, i = owner.index++; if (!same(owner.slots[i]?.deps, deps)) owner.slots[i] = { value: fn, deps }; return owner.slots[i].value; },
  useEffect(fn: () => (() => void) | void, deps: unknown[]) { const owner = scope, i = owner.index++; if (!same(owner.slots[i]?.deps, deps)) { owner.slots[i]?.cleanup?.(); const slot: Slot = { deps }; owner.slots[i] = slot; owner.pending.push(() => { slot.cleanup = fn() ?? undefined; }); } },
};
const theme = { radius: {}, spacing: {}, useTheme: () => ({ colors: {} }) };
const native = { StyleSheet: { create: (styles: unknown) => styles }, AppState: { addEventListener: () => ({ remove() {} }) } };
const flush = () => new Promise<void>(done => setImmediate(done));

test('shared receipts never render another mode’s trip or retain a result across mode changes', async () => {
  const auth = { session: { user: { id: 'driver', role: 'rider' } } };
  const hook = Object.assign((select: (state: typeof auth) => unknown) => select(auth), { getState: () => auth });
  const screens = load<{ TripReceiptScreen: () => Element }>('screens/shared/TripReceiptScreen.tsx', {
    react, 'react-native': native, 'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({ tripId: 'trip' }) },
    'react-native-safe-area-context': {}, '@/components/common': {}, '@/components/common/RideIcon': {}, '@/components/map/AddressIcon': {},
    '@/constants/theme': theme, '@/services/paymentService': {}, '@/services/tripService': { getTrip: async () => fixture() },
    '@/utils/tripHistory': {}, '@/utils/tripReceipt': {}, '@/utils/driverTripPresentation': {}, '@/store/authStore': { useAuthStore: hook }, '@/utils/roleAccess': policy,
  });
  const owner = new Scope(); owner.render(screens.TripReceiptScreen); owner.effects(); await flush();
  let view = owner.render(screens.TripReceiptScreen);
  assert.equal(view.props.trip, null); assert.match(String(view.props.error), /current mode/);
  auth.session.user.role = 'driver';
  view = owner.render(screens.TripReceiptScreen); assert.equal(view.props.trip, null); assert.equal(view.props.loading, true);
  owner.effects(); await flush(); view = owner.render(screens.TripReceiptScreen);
  assert.equal((view.props.trip as Trip).id, 'trip'); assert.equal(view.props.driver, true); owner.destroy();
});

test('shared call/chat pages reject unrelated and opposite-mode trips before mounting their content', () => {
  const auth = { session: { user: { id: 'driver', role: 'rider' } } };
  let requestedId = 'trip';
  const mocks = {
    react, 'react-native': native, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({}), useLocalSearchParams: () => ({ tripId: requestedId }) },
    'react-native-safe-area-context': {}, '@/components/common': {}, '@/constants/theme': theme,
    '@/services/socket': {}, '@/store/authStore': { useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) },
    '@/store/tripStore': { useTripStore: (select: (state: { trip: Trip }) => unknown) => select({ trip: fixture() }) }, '@/utils/roleAccess': policy,
  };
  const chat = load<{ TripChatScreen: () => Element }>('screens/shared/TripChatScreen.tsx', mocks);
  const call = load<{ TripCallScreen: () => Element }>('screens/shared/TripCallScreen.tsx', mocks);
  for (const render of [chat.TripChatScreen, call.TripCallScreen]) {
    auth.session.user.role = 'rider'; assert.equal(render().type, 'Redirect');
    auth.session.user.role = 'driver'; requestedId = 'other'; assert.equal(render().type, 'Redirect');
    requestedId = 'trip'; assert.notEqual(render().type, 'Redirect');
  }
});

test('finance read results and action callbacks cannot cross modes on the same account', async () => {
  const auth = { session: { user: { id: 'account', role: 'driver' } } };
  const hook = Object.assign((select: (state: typeof auth) => unknown) => select(auth), { getState: () => auth });
  const hooks = load<{
    useFinanceResource: (loader: () => Promise<string>) => { data: string | null; refresh: () => Promise<void> };
    useFinanceAction: () => { run: (kind: string, job: () => Promise<string>, success: (value: string) => void) => Promise<void> };
  }>('hooks/useFinanceResource.ts', { react, 'react-native': native, '@/lib/apiClient': { apiErrorMessage: (error: Error) => error.message }, '@/store/authStore': { useAuthStore: hook }, '@/store/walletStore': {} });
  const pending = deferred<string>(), read = new Scope(), loader = () => pending.promise;
  const resource = read.render(() => hooks.useFinanceResource(loader));
  const readJob = resource.refresh(); auth.session.user.role = 'rider'; pending.resolve('private-driver-earnings'); await readJob;
  assert.equal(read.render(() => hooks.useFinanceResource(loader)).data, null);
  auth.session.user.role = 'driver'; const actionOwner = new Scope();
  const action = actionOwner.render(hooks.useFinanceAction); actionOwner.effects();
  let callbacks = 0; const work = deferred<string>();
  const actionJob = action.run('payout', () => work.promise, () => { callbacks += 1; });
  auth.session.user.role = 'rider'; work.resolve('finished'); await actionJob; assert.equal(callbacks, 0);
  let requests = 0; await action.run('payout', async () => { requests += 1; return 'wrong-mode'; }, () => { callbacks += 1; });
  assert.equal(requests, 0); read.destroy(); actionOwner.destroy();
});

test('driver availability is hidden in rider mode and a late permission answer cannot start tracking', async () => {
  const auth = { session: { user: { id: 'account', role: 'rider' } }, driverApplication: { status: 'approved' }, driverServices: { vehicleCategory: 'car', services: { ride: { status: 'approved', consentAccepted: true, enabled: true }, courier: { status: 'none', consentAccepted: false, enabled: false } } } };
  const hook = Object.assign((select: (state: typeof auth) => unknown) => select(auth), { getState: () => auth });
  const permission = deferred<string>(); let starts = 0;
  const screen = load<{ DriverOnlineControl: (props: Props) => Element | null }>('components/map/DriverOnlineControl.tsx', {
    react, 'react-native': { ...native, Platform: { OS: 'ios' } }, '@/components/common': {}, '@/constants/theme': theme,
    '@/utils/driverServices': load('utils/driverServices.ts'),
    '@/store/authStore': { useAuthStore: hook }, '@/services/locationService': {
      isDriverBackgroundUpdatesActive: async () => false, areLocationServicesEnabled: async () => true,
      requestForegroundLocation: () => permission.promise, getDriverBackgroundLocationPermission: async () => 'granted',
      startDriverLocationUpdates: async () => { starts += 1; return () => undefined; },
    },
  });
  assert.equal(screen.DriverOnlineControl({ driverId: 'account' }), null);
  auth.session.user.role = 'driver'; const wrapper = screen.DriverOnlineControl({ driverId: 'account', render: (control: Element) => control })!;
  const owner = new Scope();
  const view = owner.render(() => (wrapper.type as unknown as (props: Props) => Element)(wrapper.props)); owner.effects();
  (view.props.onToggle as () => void)(); await flush();
  auth.session.user.role = 'rider'; permission.resolve('granted'); await flush();
  assert.equal(starts, 0); owner.destroy();
});

test('top-up URLs cannot select the other mode’s balance', async () => {
  for (const role of ['rider', 'driver']) {
    const auth = { session: { user: { id: 'account', role } } };
    const hook = Object.assign((select: (state: typeof auth) => unknown) => select(auth), { getState: () => auth });
    const targets: string[] = [];
    const screen = load<{ TopUpSection: () => Element }>('screens/shared/WalletSections.tsx', {
      react, 'react-native': { ...native, TextInput: 'Input' }, 'expo-web-browser': { openBrowserAsync: async () => undefined },
      'expo-router': { useLocalSearchParams: () => ({ target: role === 'driver' ? 'wallet' : 'earnings' }) },
      '@/components/common': { Text: 'Text', Button: 'Button' }, '@/constants/theme': theme,
      '@/lib/apiClient': { apiErrorMessage: (error: Error) => error.message }, '@/store/authStore': { useAuthStore: hook },
      '@/store/walletStore': { useWalletStore: (select: (state: { refresh: () => Promise<void> }) => unknown) => select({ refresh: async () => undefined }) },
      '@/services/paymentService': { formatNaira: () => 'Sample amount', createTopup: async (_amount: number, target: string) => { targets.push(target); return { reference: 'fixture', authorizationUrl: 'https://test.invalid' }; } },
    });
    const owner = new Scope();
    let children = owner.render(screen.TopUpSection).props.children as Element[];
    (children.find(child => child?.type === 'Input')!.props.onChangeText as (value: string) => void)('1000');
    children = owner.render(screen.TopUpSection).props.children as Element[];
    (children.find(child => child?.type === 'Button')!.props.onPress as () => void)(); await flush();
    assert.deepEqual(targets, [role === 'driver' ? 'earnings' : 'wallet']); owner.destroy();
  }
});
