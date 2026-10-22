import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { notificationAudience, notificationRole, type NotificationRole } from './notificationAudience';

const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number } };
const { createStore } = mobileRequire('zustand/vanilla') as { createStore: (initializer: unknown) => unknown };
function load<T>(path: string, mocks: Record<string, unknown>): T {
  const code = compiler.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, { exports, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import ${name}`); } });
  return exports as T;
}
const audience = load<{ notificationAudience: typeof notificationAudience; notificationBelongsToRole: (item: Notice, role: NotificationRole) => boolean }>('utils/notificationAudience.ts', {});
interface Notice {
  id: string; userId: string; type: string; category: string; title: string; body: string; data: Record<string, unknown>;
  eventKey: string; deepLink: string | null; createdAt: string; readAt: string | null; openedAt: string | null;
}
function notice(id: string, role: 'rider' | 'driver' | 'shared' = 'rider'): Notice {
  return { id, userId: 'account', type: 'trip_completed', category: 'trip_updates', title: 'Fixture', body: 'Fixture', data: { audience: role, tripId: `trip-${id}` }, eventKey: id, deepLink: null, createdAt: '2026-10-21T12:00:00Z', readAt: null, openedAt: null };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
interface State {
  userId: string | null; role: NotificationRole; generation: number; items: Notice[]; current: Notice | null; pending: Notice[]; unreadCount: number; loading: boolean; nextCursor: string | null;
  setContext: (id: string | null, role: NotificationRole) => void; reset: () => void; receive: (item: Notice) => void; refresh: () => Promise<void>; loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>; markOpened: (id: string) => Promise<void>; markAllRead: () => Promise<void>;
  preferences: object | null; refreshPreferences: () => Promise<void>;
}
interface Api {
  getNotifications: (cursor?: string, role?: NotificationRole) => Promise<{ notifications: Notice[]; nextCursor: string | null }>;
  getUnreadNotificationCount: (role?: NotificationRole) => Promise<number>;
  markNotificationRead: (id: string, role?: NotificationRole) => Promise<Notice>;
  markNotificationOpened: (id: string, role?: NotificationRole) => Promise<Notice>;
  markAllNotificationsRead: (role?: NotificationRole) => Promise<object>;
  getNotificationPreferences: () => Promise<object>;
  getNotificationPermission: () => Promise<object>;
}
function harness(overrides: Partial<Api> = {}) {
  const calls: unknown[][] = [];
  const api: Api = {
    getNotifications: async (cursor, role) => { calls.push(['list', cursor, role]); return { notifications: [notice('one', role)], nextCursor: null }; },
    getUnreadNotificationCount: async role => { calls.push(['count', role]); return 1; },
    markNotificationRead: async (id, role) => { calls.push(['read', id, role]); return { ...notice(id, role), readAt: 'read' }; },
    markNotificationOpened: async (id, role) => { calls.push(['open', id, role]); return { ...notice(id, role), readAt: 'read', openedAt: 'opened' }; },
    markAllNotificationsRead: async role => { calls.push(['all', role]); return {}; },
    getNotificationPreferences: async () => ({}), getNotificationPermission: async () => ({}), ...overrides,
  };
  const store = load<{ useNotificationStore: { getState: () => State } }>('store/notificationStore.ts', { zustand: { create: createStore }, '@/services/notificationService': api, '@/utils/notificationAudience': audience }).useNotificationStore;
  store.getState().setContext('account', 'rider');
  return { state: store.getState, calls, api };
}

test('mobile and backend classify legacy and explicitly labelled notifications identically', () => {
  const fixtures = [
    { type: 'trip_completed', eventKey: 'trip:one:driver' }, { type: 'trip_completed', eventKey: 'trip:one:rider' },
    { type: 'trip_cancelled', deepLink: '/driver-trip?tripId=one' }, { type: 'driver_arrived', deepLink: '/ongoing-trip' },
    { type: 'ride_offer', category: 'driver_offers' }, { type: 'driver_application_approved', category: 'support' },
    { type: 'withdrawal_failed', category: 'wallet_updates' }, { type: 'refund_posted', deepLink: '/account/driver-wallet' },
    { type: 'ride_payment_settled', deepLink: '/account/driver-wallet' },
    { type: 'topup_succeeded', title: 'Wallet top-up successful', deepLink: '/account/driver-wallet' },
    { type: 'topup_succeeded', title: 'Earnings balance updated', deepLink: '/account/driver-wallet' },
    { type: 'topup_succeeded', data: { target: 'earnings' } }, { category: 'scheduled_reminders' },
    { type: 'support_updated', category: 'support' }, { type: 'safety_updated', category: 'safety_security' },
    { type: 'promotion', category: 'promotions' }, { data: { audience: 'driver' } }, { data: { audience: 'rider' } }, { data: { audience: 'shared' } },
  ];
  for (const fixture of fixtures) {
    const item = { ...notice('legacy'), data: {}, ...fixture };
    assert.equal(audience.notificationAudience(item), notificationAudience(item));
  }
  assert.equal(notificationRole(undefined), undefined);
  for (const invalid of [null, '', 'both', ['driver'], { role: 'rider' }]) assert.throws(() => notificationRole(invalid), /invalid_notification_role/);
});

test('role changes clear cached lists, unread count, banners and pagination immediately', async () => {
  const h = harness(); await h.state().refresh(); h.state().receive(notice('banner'));
  assert.ok(h.state().current); h.state().setContext('account', 'driver');
  assert.equal(h.state().items.length, 0); assert.equal(h.state().current, null); assert.equal(h.state().pending.length, 0);
  assert.equal(h.state().unreadCount, 0); assert.equal(h.state().nextCursor, null);
  await h.state().refresh(); assert.equal(h.state().items[0].data.audience, 'driver');
  assert.ok(h.calls.some(call => call[0] === 'list' && call[2] === 'driver'));
  assert.ok(h.calls.some(call => call[0] === 'count' && call[1] === 'driver'));
});

test('socket events respect mode and recipient, shared updates remain visible and duplicate delivery is ignored', () => {
  const h = harness(); h.state().setContext('account', 'driver');
  h.state().receive(notice('rider')); h.state().receive({ ...notice('other', 'driver'), userId: 'another-account' });
  assert.equal(h.state().items.length, 0);
  h.state().receive(notice('driver', 'driver')); h.state().receive(notice('shared', 'shared')); h.state().receive(notice('driver', 'driver'));
  assert.equal(h.state().items.length, 2); assert.equal(h.state().unreadCount, 2);
});

test('late inbox and preference responses cannot cross modes or restore data after logout', async () => {
  const list = deferred<{ notifications: Notice[]; nextCursor: string | null }>(); const prefs = deferred<object>();
  const h = harness({ getNotifications: () => list.promise, getNotificationPreferences: () => prefs.promise });
  const loading = h.state().refresh(), preferences = h.state().refreshPreferences();
  h.state().setContext('account', 'driver');
  list.resolve({ notifications: [notice('late')], nextCursor: 'old' }); prefs.resolve({ old: true });
  await Promise.all([loading, preferences]); assert.equal(h.state().items.length, 0); assert.equal(h.state().preferences, null); assert.equal(h.state().loading, false);
  const again = deferred<{ notifications: Notice[]; nextCursor: string | null }>(); h.api.getNotifications = () => again.promise;
  const pending = h.state().refresh(); h.state().reset(); again.resolve({ notifications: [notice('late-driver', 'driver')], nextCursor: null }); await pending;
  assert.equal(h.state().userId, null); assert.equal(h.state().items.length, 0);
});

test('duplicate refresh calls share a request and realtime arrival survives a stale snapshot', async () => {
  const first = deferred<{ notifications: Notice[]; nextCursor: string | null }>(); let count = 0;
  const h = harness({ getNotifications: async () => { count += 1; return count === 1 ? first.promise : { notifications: [notice('fresh')], nextCursor: null }; } });
  const a = h.state().refresh(), b = h.state().refresh(); assert.equal(a, b);
  h.state().receive(notice('fresh')); first.resolve({ notifications: [], nextCursor: null }); await a;
  assert.equal(count, 2); assert.equal(h.state().items[0].id, 'fresh'); assert.equal(h.state().loading, false);
});

test('pagination is scoped and a late page cannot enter the next mode', async () => {
  const page = deferred<{ notifications: Notice[]; nextCursor: string | null }>();
  const calls: unknown[][] = [];
  const h = harness({ getNotifications: async (cursor, role) => { calls.push([cursor, role]); return cursor ? page.promise : { notifications: [notice('first')], nextCursor: 'cursor' }; } });
  await h.state().refresh(); const loading = h.state().loadMore(); h.state().setContext('account', 'driver');
  page.resolve({ notifications: [notice('late-page')], nextCursor: null }); await loading;
  assert.deepEqual(calls, [[undefined, 'rider'], ['cursor', 'rider']]); assert.equal(h.state().items.length, 0);
});

test('read operations carry mode and late reads cannot navigate or populate another account', async () => {
  const h = harness(); await h.state().refresh(); await h.state().markRead('one'); await h.state().markRead('one');
  assert.equal(h.state().unreadCount, 0);
  await h.state().markAllRead(); assert.ok(h.calls.some(call => call[0] === 'all' && call[1] === 'rider'));
  assert.ok(h.calls.some(call => call[0] === 'read' && call[2] === 'rider'));
  const write = deferred<Notice>(); h.api.markNotificationOpened = () => write.promise;
  const pending = h.state().markOpened('one'); h.state().setContext('other-account', 'rider'); write.resolve({ ...notice('one'), readAt: 'read' });
  await assert.rejects(pending, /mode changed/); assert.equal(h.state().items.length, 0);
});

test('notification destinations use participant role and the original trip identity', () => {
  const service = load<{ notificationDestination: (item: Notice) => unknown }>('services/notificationService.ts', {
    '@/utils/notificationAudience': audience, 'expo-constants': {}, 'expo-device': {}, 'expo-modules-core': {}, 'expo-secure-store': {}, 'react-native': {}, '@/lib/apiClient': {},
  });
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
  assert.deepEqual(plain(service.notificationDestination(notice('done', 'driver'))), { pathname: '/trip-receipt', params: { tripId: 'trip-done' } });
  assert.equal(service.notificationDestination({ ...notice('cancel', 'driver'), type: 'trip_cancelled' }), '/driver-dashboard');
  assert.equal(service.notificationDestination({ ...notice('cancel'), type: 'trip_cancelled' }), '/home');
  assert.deepEqual(plain(service.notificationDestination({ ...notice('earn', 'driver'), type: 'topup_succeeded', category: 'wallet_updates' })), { pathname: '/account/[section]', params: { section: 'driver-wallet' } });
  assert.deepEqual(plain(service.notificationDestination({ ...notice('pay'), type: 'ride_payment_settled', category: 'wallet_updates' })), { pathname: '/account/[section]', params: { section: 'payment' } });
  assert.equal(service.notificationDestination({ ...notice('app', 'driver'), category: 'support', type: 'driver_application_rejected' }), '/driver-status');
});

test('failed refresh keeps existing notifications and can retry', async () => {
  const h = harness(); await h.state().refresh();
  h.api.getNotifications = async () => { throw new Error('offline'); };
  await assert.rejects(h.state().refresh(), /offline/);
  assert.equal(h.state().loading, false); assert.equal(h.state().items[0].id, 'one');
  h.api.getNotifications = async () => ({ notifications: [notice('reconnected')], nextCursor: null });
  await h.state().refresh(); assert.equal(h.state().items[0].id, 'reconnected');
});

test('native taps validate ownership, switch mode once, and do not replay after a mode change', async () => {
  const calls: unknown[][] = [];
  const effects: (() => void | (() => void))[] = [];
  let response!: (item: { notification: Notice }) => void;
  let received!: () => void;
  const auth = { session: { user: { id: 'account', role: 'rider' as NotificationRole } }, setRole: async (role: NotificationRole) => { calls.push(['role', role]); auth.session.user.role = role; store.generation += 1; return true; } };
  const store = { generation: 1, preferences: null, permission: null, unreadCount: 0,
    setContext: () => undefined, receive: () => { calls.push(['receive']); }, refresh: async () => { calls.push(['refresh']); }, refreshPreferences: async () => undefined };
  const authHook = Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth });
  const storeHook = Object.assign((selector: (state: typeof store) => unknown) => selector(store), { getState: () => store });
  const native = {
    addNotificationReceivedListener: (handler: typeof received) => { received = handler; return { remove() {} }; },
    addNotificationResponseReceivedListener: (handler: typeof response) => { response = handler; return { remove() {} }; },
    addPushTokenListener: () => ({ remove() {} }), getLastNotificationResponse: () => null, setBadgeCountAsync: async () => undefined,
  };
  const { NotificationBootstrap } = load<{ NotificationBootstrap: () => null }>('components/notifications/NotificationBootstrap.tsx', {
    react: { useEffect: (effect: () => void | (() => void)) => effects.push(effect), useRef: () => ({ current: null }) },
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useRouter: () => ({ push: (destination: unknown) => calls.push(['push', destination]) }) },
    '@/services/socket': { subscribeToNotifications: () => () => undefined },
    '@/services/notificationService': {
      getNotificationsModule: async () => native, registerCurrentDevice: async () => undefined, notificationFromNative: (value: Notice) => value,
      markNotificationOpened: async (id: string) => { calls.push(['authenticate', id]); if (id === 'wrong-owner') throw new Error('not_found'); return notice(id, 'driver'); },
      notificationDestination: () => '/driver-dashboard',
    },
    '@/store/notificationStore': { useNotificationStore: storeHook }, '@/store/authStore': { useAuthStore: authHook }, '@/utils/notificationAudience': audience,
  });
  NotificationBootstrap(); const cleanups = effects.map(effect => effect());
  const flush = () => new Promise<void>(done => setImmediate(done)); await flush();
  received(); await flush(); assert.ok(calls.filter(call => call[0] === 'refresh').length >= 2);
  response({ notification: notice('wrong-owner', 'driver') }); await flush();
  assert.equal(calls.filter(call => call[0] === 'push').length, 0);
  response({ notification: notice('driver-alert', 'driver') }); await flush();
  assert.ok(calls.findIndex(call => call[0] === 'authenticate' && call[1] === 'driver-alert') < calls.findIndex(call => call[0] === 'role'));
  assert.equal(calls.filter(call => call[0] === 'role').length, 1); assert.equal(calls.filter(call => call[0] === 'push').length, 1);
  response({ notification: notice('driver-alert', 'driver') }); await flush();
  assert.equal(calls.filter(call => call[0] === 'push').length, 1);
  cleanups.forEach(cleanup => { if (cleanup) cleanup(); });
});
