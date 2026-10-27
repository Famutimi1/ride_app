import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props; key?: string }
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
  useEffect(fn: () => (() => void) | void, deps: unknown[]) { const owner = scope, i = owner.index++; if (!equal(owner.slots[i]?.deps, deps)) { owner.slots[i]?.cleanup?.(); const slot: Slot = { deps }; owner.slots[i] = slot; owner.pending.push(() => { slot.cleanup = fn() ?? undefined; }); } },
};
const jsx = (type: Element['type'], props: Props, key?: string): Element => ({ type, props, key });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const flush = () => new Promise<void>(done => setImmediate(done));
const invoke = (props: Props, name: string, ...args: unknown[]) => (props[name] as (...args: unknown[]) => void)(...args);
const modules: Record<string, unknown> = {};
function load<T>(path: string, overrides: Record<string, unknown> = {}): T {
  const exports: Record<string, unknown> = {};
  const code = compiler.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX } }).outputText;
  const mocks = { ...modules, ...overrides };
  runInNewContext(code, { exports, require: (name: string) => { const feedbackModule = mobileFeedbackDependency(name); if (feedbackModule) return feedbackModule; if (name in mocks) return mocks[name]; throw new Error(`Unexpected import ${name}`); } });
  return exports as T;
}
interface Content { title: string; entries: { destination: string; label: string }[] }
interface Constants { getSettingsContent: (role: string) => Content; getAlertPreferences: (role: string) => { key: string; label: string }[] }
modules['./driver'] = load('constants/settings/driver.ts'); modules['./rider'] = load('constants/settings/rider.ts');
const constants = load<Constants>('constants/settings/index.ts'); modules['@/constants/settings'] = constants;
const helpers = load<{ settingsDestination: (destination: string, role: string) => unknown; permissionLabel: (state: string | null) => string; settingsLocationNotice: (role: string) => string }>('utils/settings.ts');
modules['@/utils/settings'] = helpers;
const preferences = { pushEnabled: true, tripUpdatesEnabled: true, driverOffersEnabled: true, scheduledRemindersEnabled: true, walletUpdatesEnabled: true, promotionsEnabled: false, soundEnabled: true, vibrationEnabled: true };
const calls: unknown[][] = [];
let logoutJob: () => Promise<void> = async () => { auth.session = null; };
const auth: { session: { user: { id: string; role: string } } | null; driverApplication: { status: string }; logout: () => Promise<void> } = { session: { user: { id: 'account', role: 'driver' } }, driverApplication: { status: 'approved' }, logout: () => { calls.push(['logout']); return logoutJob(); } };
const authHook = Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth });
const notification = { preferences, permission: { granted: true, canAskAgain: true, status: 'granted' }, refreshPreferences: async () => { calls.push(['refresh']); }, savePreferences: async (input: unknown) => { calls.push(['save', input]); } };
let permissionJob = async (): Promise<object> => ({ granted: true });
let locationJob = async (): Promise<string> => 'granted';
const listeners: ((state: string) => void)[] = [];
const native = { Platform: { OS: 'android' }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', Switch: 'Switch',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, AppState: { addEventListener: (_name: string, handler: (state: string) => void) => { listeners.push(handler); return { remove: () => undefined }; } },
  Linking: { openSettings: async () => { calls.push(['settings']); } } };
modules.react = react; modules['react/jsx-runtime'] = { jsx, jsxs: jsx }; modules['react-native'] = native;
modules['expo-router'] = { Redirect: 'Redirect', useRouter: () => ({ push: (value: unknown) => calls.push(['push', value]), replace: (value: unknown) => calls.push(['replace', value]), canGoBack: () => false }) };
modules['react-native-safe-area-context'] = { SafeAreaView: 'SafeAreaView' };
modules['@/components/common'] = { Text: 'Text', Button: 'Button' }; modules['@/components/common/RideIcon'] = { RideIcon: 'Icon' };
modules['@/components/common/ThemePreferencePicker'] = { ThemePreferencePicker: 'Appearance' }; modules['@/components/map/AddressIcon'] = { AddressIcon: 'Icon' };
modules['@/components/common/DriverServiceSettings'] = { DriverServicePreferences: 'DriverServicePreferences' };
modules['@/constants/theme'] = { spacing: {}, radius: {}, borderWidths: { divider: 1 }, useTheme: () => ({ colors: new Proxy({}, { get: (_target, key) => key }) }) };
modules['@/store/authStore'] = { useAuthStore: authHook };
modules['@/store/notificationStore'] = { useNotificationStore: (selector: (state: typeof notification) => unknown) => selector(notification) };
modules['@/services/notificationService'] = {
  configureNotificationChannels: async () => { calls.push(['channels']); }, notificationPermissionMessage: () => 'Sample permission',
  registerCurrentDevice: async () => { calls.push(['register']); }, requestNotificationPermission: () => { calls.push(['permission']); return permissionJob(); },
};
modules['@/services/locationService'] = {
  getForegroundLocationPermission: () => { calls.push(['foreground']); return locationJob(); },
  getDriverBackgroundLocationPermission: async () => { calls.push(['background']); return 'denied'; },
  areLocationServicesEnabled: async () => { calls.push(['services']); return true; },
};
const panel = load<{ LocationPermissionsPanel: (props: Props) => Element; LocationPermissionsView: (props: Props) => Element }>('components/settings/LocationPermissionsPanel.tsx'); modules['@/components/settings/LocationPermissionsPanel'] = panel;
const alerts = load<{ NotificationPreferencesPanel: () => Element; NotificationPreferencesView: (props: Props) => Element }>('components/notifications/NotificationPreferencesPanel.tsx'); modules['@/components/notifications'] = alerts;
const screens = load<{ SettingsScreen: () => Element; SettingsView: (props: Props) => Element; DriverServicesSettingsScreen: () => Element; NotificationSettingsScreen: () => Element }>('screens/shared/SettingsScreen.tsx');
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  if (typeof node.type === 'function') return [node, ...nodes(new Scope().render(() => (node.type as (props: Props) => Element)(node.props)))];
  return [node, ...nodes(node.props.children)];
}
const text = (list: Element[]) => list.map(node => typeof node.props.children === 'string' ? node.props.children : '').join(' ');
function controller(component: () => Element) { const wrapper = new Scope().render(component); const owner = new Scope(); const render = () => owner.render(() => (wrapper.type as (props: Props) => Element)(wrapper.props)); render(); owner.effects(); return { render, owner }; }
function session(role = 'driver', id = 'account') { auth.session = { user: { id, role } }; calls.length = 0; }

test('settings content separates real rider and driver management routes', () => {
  const driver = constants.getSettingsContent('driver'), rider = constants.getSettingsContent('rider');
  assert.equal(driver.title, 'Driver settings'); assert.equal(rider.title, 'Rider settings');
  assert.ok(driver.entries.some(entry => entry.destination === 'services'));
  assert.ok(!driver.entries.some(entry => ['vehicle', 'payouts', 'application'].includes(entry.destination)));
  assert.ok(!rider.entries.some(entry => ['services', 'vehicle', 'payouts', 'application'].includes(entry.destination)));
  assert.ok(!driver.entries.some(entry => entry.destination === 'payments'));
  for (const role of ['driver', 'rider']) {
    const list = nodes(new Scope().render(() => screens.SettingsView({ role, loggingOut: false, error: null, onNavigate() {}, onBack() {}, onLogout() {} })));
    assert.ok(!text(list).includes('Coming soon'));
    assert.equal(text(list).includes('Profile & phone'), role === 'rider');
    if (role === 'driver') {
      assert.ok(text(list).includes('Notification settings'));
      assert.ok(text(list).includes('Service settings'));
      assert.ok(!text(list).includes('Notification history'));
    }
  }
});

test('settings navigation rejects opposite-mode actions and uses existing destinations', () => {
  for (const destination of ['services', 'vehicle', 'payouts', 'application']) assert.equal(helpers.settingsDestination(destination, 'rider'), null);
  assert.equal(helpers.settingsDestination('payments', 'driver'), null);
  assert.equal(helpers.settingsDestination('application', 'driver'), '/driver-status');
  assert.deepEqual(plain(helpers.settingsDestination('services', 'driver')), { pathname: '/account/[section]', params: { section: 'driver-services' } });
  assert.deepEqual(plain(helpers.settingsDestination('location', 'rider')), { pathname: '/account/[section]', params: { section: 'location-settings' } });
});

test('approved drivers using rider mode see rider settings and cannot deep link into request controls', () => {
  session('rider');
  const c = controller(screens.SettingsScreen); assert.equal(c.render().props.role, 'rider');
  invoke(c.render().props, 'onNavigate', 'services'); assert.equal(calls.length, 0);
  const redirect = new Scope().render(screens.DriverServicesSettingsScreen); assert.equal(redirect.type, 'Redirect');
  assert.deepEqual(plain(redirect.props.href), { pathname: '/account/[section]', params: { section: 'settings' } });
  c.owner.destroy();
});

test('stale settings callbacks cannot navigate or log out after account/mode changes', () => {
  session(); const c = controller(screens.SettingsScreen); const props = c.render().props;
  session('rider'); invoke(props, 'onNavigate', 'payouts'); invoke(props, 'onLogout'); assert.equal(calls.length, 0);
  session('driver', 'different'); invoke(props, 'onNavigate', 'vehicle'); invoke(props, 'onLogout'); assert.equal(calls.length, 0);
  c.owner.destroy();
});

test('logout submits once and leaves the signed-in area after local cleanup even if revocation fails', async () => {
  session(); const wait = deferred<void>(); logoutJob = () => wait.promise;
  const c = controller(screens.SettingsScreen), props = c.render().props;
  invoke(props, 'onLogout'); invoke(props, 'onLogout'); invoke(props, 'onNavigate', 'history');
  await flush(); // The explicit confirmation resolves before revocation starts.
  assert.equal(calls.filter(call => call[0] === 'logout').length, 1); assert.equal(calls.filter(call => call[0] === 'push').length, 0);
  auth.session = null; wait.reject(new Error('revocation offline')); await flush();
  assert.ok(calls.some(call => call[0] === 'replace' && call[1] === '/welcome')); c.owner.destroy();
});

test('notification controls follow active mode while preserving real backend preference keys', () => {
  const driver = constants.getAlertPreferences('driver'), rider = constants.getAlertPreferences('rider');
  assert.ok(driver.some(entry => entry.key === 'driverOffersEnabled')); assert.ok(!driver.some(entry => entry.key === 'scheduledRemindersEnabled'));
  assert.ok(rider.some(entry => entry.key === 'scheduledRemindersEnabled')); assert.ok(!rider.some(entry => entry.key === 'driverOffersEnabled'));
  for (const role of ['driver', 'rider']) {
    session(role); const c = controller(alerts.NotificationPreferencesPanel); assert.equal(c.render().props.driver, role === 'driver'); c.owner.destroy();
    const list = nodes(new Scope().render(() => alerts.NotificationPreferencesView({ driver: role === 'driver', preferences, permission: notification.permission, saving: null, loadError: null, changeError: null, onChange() {}, onRetry() {}, onDeviceSettings() {}, onHistory() {} })));
    assert.equal(text(list).includes('Scheduled rides'), role === 'rider');
    assert.equal(text(list).includes('Ride & courier offers'), role === 'driver');
    assert.ok(text(list).includes('apply to both modes'));
  }
});

test('notification saves reject hidden role controls and preserve existing preference writes', async () => {
  session('rider'); const c = controller(alerts.NotificationPreferencesPanel); const props = c.render().props;
  invoke(props, 'onChange', 'driverOffersEnabled', false); await flush(); assert.ok(!calls.some(call => call[0] === 'save'));
  invoke(props, 'onChange', 'scheduledRemindersEnabled', false); await flush();
  assert.ok(calls.some(call => call[0] === 'save' && (call[1] as Props).scheduledRemindersEnabled === false)); c.owner.destroy();
});

test('a permission answer after a mode switch cannot register or save the previous settings', async () => {
  session(); const wait = deferred<object>(); permissionJob = () => wait.promise;
  const c = controller(alerts.NotificationPreferencesPanel), props = c.render().props;
  invoke(props, 'onChange', 'pushEnabled', true); invoke(props, 'onChange', 'pushEnabled', true);
  assert.equal(calls.filter(call => call[0] === 'permission').length, 1);
  session('rider'); wait.resolve({ granted: true }); await flush();
  assert.ok(!calls.some(call => call[0] === 'save' || call[0] === 'register')); c.owner.destroy();
});

test('push registration precedes a successful save and refused permission never enables push', async () => {
  session(); permissionJob = async () => ({ granted: true });
  const c = controller(alerts.NotificationPreferencesPanel);
  invoke(c.render().props, 'onChange', 'pushEnabled', true); await flush();
  assert.ok(calls.findIndex(call => call[0] === 'permission') < calls.findIndex(call => call[0] === 'register'));
  assert.ok(calls.findIndex(call => call[0] === 'register') < calls.findIndex(call => call[0] === 'save'));
  calls.length = 0; permissionJob = async () => ({ granted: false });
  invoke(c.render().props, 'onChange', 'pushEnabled', true); await flush();
  assert.ok(!calls.some(call => call[0] === 'register' || call[0] === 'save'));
  c.owner.destroy();
});

test('driver location reads foreground/background status without requesting access', async () => {
  session(); native.Platform.OS = 'android'; locationJob = async () => 'granted';
  const owner = new Scope(); const render = () => owner.render(() => panel.LocationPermissionsPanel({ role: 'driver' }));
  render(); owner.effects(); await flush();
  const props = render().props; assert.equal((props.snapshot as Props).background, 'denied'); assert.equal((props.snapshot as Props).foreground, 'granted');
  assert.deepEqual(calls.map(call => call[0]).sort(), ['background', 'foreground', 'services']);
  const list = nodes(new Scope().render(() => panel.LocationPermissionsView(props)));
  assert.ok(text(list).includes('Background location')); assert.ok(text(list).includes('Not allowed')); owner.destroy();
});

test('rider location omits background access, and web does not report background as granted', async () => {
  session('rider'); native.Platform.OS = 'android'; const owner = new Scope();
  owner.render(() => panel.LocationPermissionsPanel({ role: 'rider' })); owner.effects(); await flush();
  assert.ok(!calls.some(call => call[0] === 'background')); owner.destroy();
  calls.length = 0; native.Platform.OS = 'web'; const web = new Scope();
  const element = web.render(() => panel.LocationPermissionsPanel({ role: 'driver' })); web.effects(); await flush();
  assert.equal(calls.length, 0); const list = nodes(new Scope().render(() => panel.LocationPermissionsView(element.props)));
  assert.ok(text(list).includes('installed mobile app')); assert.ok(!text(list).includes('Allowed')); web.destroy(); native.Platform.OS = 'android';
});

test('location read errors remain unknown and late responses cannot update an unmounted panel', async () => {
  const wait = deferred<string>(); locationJob = () => wait.promise; const owner = new Scope();
  const render = () => owner.render(() => panel.LocationPermissionsPanel({ role: 'driver' })); render(); owner.effects(); await flush(); owner.destroy();
  wait.resolve('granted'); await flush(); assert.equal(render().props.snapshot, null);
  locationJob = async () => { throw new Error('unavailable'); }; const failed = new Scope();
  const read = () => failed.render(() => panel.LocationPermissionsPanel({ role: 'rider' })); read(); failed.effects(); await flush();
  assert.equal(read().props.snapshot, null); assert.match(String(read().props.error), /Could not read/); failed.destroy();
});

test('permission labels distinguish denied/blocked/not requested and browser instructions remain role-specific', () => {
  assert.equal(helpers.permissionLabel('granted'), 'Allowed'); assert.equal(helpers.permissionLabel('blocked'), 'Blocked in device settings');
  assert.equal(helpers.permissionLabel('restricted'), 'Not requested'); assert.equal(helpers.permissionLabel(null), 'Not available');
  assert.match(helpers.settingsLocationNotice('rider'), /pickup address/); assert.match(helpers.settingsLocationNotice('driver'), /installed mobile app/);
});

test('failed permission refresh clears previously allowed status instead of showing it as current', async () => {
  native.Platform.OS = 'android'; locationJob = async () => 'granted';
  const owner = new Scope(); const render = () => owner.render(() => panel.LocationPermissionsPanel({ role: 'driver' }));
  render(); owner.effects(); await flush(); assert.ok(render().props.snapshot);
  locationJob = async () => { throw new Error('device unavailable'); };
  invoke(render().props, 'onRefresh'); await flush(); assert.equal(render().props.snapshot, null); owner.destroy();
});
