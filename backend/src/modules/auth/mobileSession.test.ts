import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the actual mobile modules with controlled network/native storage.
// Reuse the mobile compiler and Zustand already installed in this repository.
const mobileRequire = createRequire(resolve('../mobile/package.json'));
const compiler = mobileRequire('typescript') as {
  transpileModule: (source: string, options: object) => { outputText: string };
  ModuleKind: { CommonJS: number };
  ScriptTarget: { ES2022: number };
};
const { createStore } = mobileRequire('zustand/vanilla') as { createStore: (initializer: unknown) => unknown };

interface Tokens {
  setTokens: (tokens: { accessToken: string; refreshToken: string }, expected?: string) => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  getRefreshToken: () => Promise<string | null>;
  clear: () => Promise<void>;
}
interface Client {
  refreshAccessToken: () => Promise<void>;
  subscribeSessionExpired: (listener: () => void) => () => void;
  isSessionRejected: (error: unknown) => boolean;
}
interface AuthState {
  driverServices: {version:number}|null;
  refreshDriverServices:()=>Promise<void>;
  saveDriverServicePreferences:(ride:boolean,courier:boolean)=>Promise<void>;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
  session: unknown;
  _sessionError: string | null;
  _hasHydrated: boolean;
  updateAvatar:(file:null)=>Promise<void>;
  updateProfile: (input: { name: string }) => Promise<void>;
  changePhone: (challenge: string, code: string) => Promise<void>;
  setRole: (role: 'rider' | 'driver') => Promise<boolean>;
}

test('photo responses update only the current account and cannot overwrite a newer revision',async()=>{
  const requests:((value:unknown)=>void)[]=[];
  const h=harness({'@/services/authService':{getMe:async()=>({user:{id:'rider-one',name:'Rider',avatarVersion:0},activeRole:'rider',driverStatus:'none'}),saveAvatar:()=>new Promise(resolve=>requests.push(resolve)),logoutSession:async()=>undefined}});
  await h.tokens.setTokens({accessToken:'access',refreshToken:'refresh'});await h.auth().hydrate();
  const first=h.auth().updateAvatar(null),second=h.auth().updateAvatar(null);
  requests[1]({user:{id:'rider-one',avatarVersion:2,avatarUrl:'new-photo'},activeRole:'rider'});await second;
  requests[0]({user:{id:'rider-one',avatarVersion:1,avatarUrl:'old-photo'},activeRole:'rider'});await first;
  assert.equal((h.auth().session as {user:{avatarUrl:string}}).user.avatarUrl,'new-photo');
  const late=h.auth().updateAvatar(null);await h.auth().logout();
  requests[2]({user:{id:'rider-one',avatarVersion:3,avatarUrl:'late-photo'},activeRole:'rider'});
  await assert.rejects(late,/session changed/);assert.equal(h.auth().session,null);
});

test('late account responses preserve a newly saved photo', async t => {
  for (const action of ['hydrate', 'updateProfile', 'changePhone'] as const) {
    await t.test(action, async () => {
      let complete!: (value: unknown) => void;
      let initial = true;
      const previous = { user: { id: 'rider-one', name: 'Rider', avatarVersion: 0, avatarUrl: 'previous' }, activeRole: 'rider', driverStatus: 'none' };
      const deferred = () => new Promise(resolve => { complete = resolve; });
      const h = harness({ '@/services/authService': {
        getMe: async () => { if (initial) { initial = false; return previous; } return deferred(); },
        saveProfile: deferred,
        confirmPhoneChange: deferred,
        saveAvatar: async () => ({ ...previous, user: { ...previous.user, avatarVersion: 1, avatarUrl: 'new-photo' } }),
      } });
      await h.tokens.setTokens({ accessToken: 'access', refreshToken: 'refresh' });
      await h.auth().hydrate();
      const pending = action === 'hydrate' ? h.auth().hydrate() : action === 'updateProfile' ? h.auth().updateProfile({ name: 'Updated' }) : h.auth().changePhone('challenge', '123456');
      // Hydration awaits secure storage before requesting the account.
      while (!complete) await Promise.resolve();
      await h.auth().updateAvatar(null);
      complete(previous);
      await pending;
      const user = (h.auth().session as { user: { avatarUrl: string; avatarVersion: number } }).user;
      assert.equal(user.avatarUrl, 'new-photo');
      assert.equal(user.avatarVersion, 1);
    });
  }
});

test('mobile service settings cannot cross accounts or overwrite a newer version', async t => {
  await t.test('a late service response cannot restore settings after logout', async () => {
    let complete!: (value: unknown) => void;
    const h=harness({'@/services/driverService':{getDriverServiceSettings:()=>new Promise(resolve=>{complete=resolve;})}});
    await h.tokens.setTokens({accessToken:'access',refreshToken:'refresh'});
    await h.auth().hydrate();
    const pending=h.auth().refreshDriverServices();
    await h.auth().logout();
    complete({version:9});await pending;
    assert.equal(h.auth().driverServices,null);
  });
  await t.test('an older service response cannot replace the newer saved version', async () => {
    const requests:((value:unknown)=>void)[]=[];
    const h=harness({'@/services/driverService':{getDriverServiceSettings:()=>new Promise(resolve=>requests.push(resolve))}});
    await h.tokens.setTokens({accessToken:'access',refreshToken:'refresh'});
    await h.auth().hydrate();
    const first=h.auth().refreshDriverServices(),second=h.auth().refreshDriverServices();
    requests[1]({version:2});await second;
    requests[0]({version:1});await first;
    assert.equal(h.auth().driverServices?.version,2);
  });
  await t.test('changing account clears settings even when the next version is lower', async () => {
    let version=9;
    const h=harness({'@/services/driverService':{getDriverServiceSettings:async()=>({version})}});
    await h.tokens.setTokens({accessToken:'access',refreshToken:'refresh'});
    await h.auth().hydrate();await h.auth().refreshDriverServices();
    h.me(async()=>({user:{id:'different-account',name:'Other'},activeRole:'driver',driverStatus:'approved'}));
    await h.auth().hydrate();assert.equal(h.auth().driverServices,null);
    version=0;await h.auth().refreshDriverServices();
    assert.equal(h.auth().driverServices?.version,0);
  });
  await t.test('a failed preference save does not pretend the new setting was saved', async () => {
    const h=harness({'@/services/driverService':{getDriverServiceSettings:async()=>({version:3}),updateDriverServicePreferences:async()=>{throw new Error('service offline');}}});
    await h.tokens.setTokens({accessToken:'access',refreshToken:'refresh'});
    await h.auth().hydrate();await h.auth().refreshDriverServices();
    await assert.rejects(h.auth().saveDriverServicePreferences(false,false),/service offline/);
    assert.equal(h.auth().driverServices?.version,3);
  });
});

function harness(overrides: Record<string, unknown> = {}) {
  const values = new Map<string, string>();
  let provider: () => Promise<{ data: unknown }> = async () => ({ data: { tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } } });
  let me: () => Promise<unknown> = async () => ({ user: { id: 'rider-one', name: 'Rider' }, activeRole: 'rider', driverStatus: 'none' });
  let save: () => Promise<unknown> = async () => ({ user: { id: 'rider-one', name: 'Updated' }, activeRole: 'rider', driverStatus: 'none' });
  let onRequest!: (config: { headers: Record<string, string> }) => Promise<{ headers: Record<string, string> }>;
  let onFailure!: (error: unknown) => Promise<unknown>;
  const modules = new Map<string, Record<string, unknown>>();
  const mocks: Record<string, unknown> = {
    'expo-secure-store': {
      setItemAsync: async (key: string, value: string) => { values.set(key, value); },
      getItemAsync: async (key: string) => values.get(key) ?? null,
      deleteItemAsync: async (key: string) => { values.delete(key); },
    },
    'react-native': { Platform: { OS: 'ios' }, Alert: { alert: () => undefined } },
    'axios': { __esModule: true, default: { post: () => provider() }, create: () => ({ interceptors: { request: { use: (handler: typeof onRequest) => { onRequest = handler; } }, response: { use: (_success: unknown, failure: typeof onFailure) => { onFailure = failure; } } } }), isAxiosError: (error: { isAxiosError?: boolean }) => error?.isAxiosError === true },
    '@/services/api': { API_BASE_URL: 'https://test.invalid' },
    'zustand': { create: createStore },
    '@/services/authService': { getMe: () => me(), saveProfile: () => save(), logoutSession: async () => undefined },
    '@/services/googleSignIn': {},
    '@/services/driverService': {},
    '@/services/socket': { resetSocket: () => undefined },
    '@/services/locationService': { stopAllDriverLocationUpdates: async () => undefined, markDriverOffline: async () => undefined, stopDriverBackgroundUpdates: async () => undefined },
    '@/store/walletStore': { useWalletStore: { getState: () => ({ reset: () => undefined }) } },
    '@/store/mapStore': { useMapStore: { getState: () => ({ clearUserLocation: () => undefined, clearTripMap: () => undefined }) } },
    '@/store/tripStore': { useTripStore: { getState: () => ({ clear: () => undefined }) } },
    '@/store/courierDraftStore': { useCourierDraftStore: { getState: () => ({ clearDraft: () => undefined }) } },
    '@/services/notificationService': { currentDeviceRegistrationId: async () => null, revokeCurrentDevice: async () => undefined },
    '@/store/notificationStore': { useNotificationStore: { getState: () => ({ reset: () => undefined, setContext: () => undefined }) } },
  };
  Object.assign(mocks, overrides);
  function load(path: string): Record<string, unknown> {
    if (modules.has(path)) return modules.get(path)!;
    const exports: Record<string, unknown> = {};
    modules.set(path, exports);
    const source = readFileSync(resolve('../mobile/src', path), 'utf8');
    const code = compiler.transpileModule(source, { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === './secureTokenStore' || name === '@/lib/secureTokenStore') return load('lib/secureTokenStore.ts');
      if (name === '@/lib/apiClient') return load('lib/apiClient.ts');
      if (name === './socket') return mocks['@/services/socket'];
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected test import: ${name}`);
    }, Set, Promise, Error });
    return exports;
  }
  return {
    tokens: load('lib/secureTokenStore.ts').tokenStore as Tokens,
    client: load('lib/apiClient.ts') as unknown as Client,
    auth: () => (load('store/authStore.ts').useAuthStore as { getState: () => AuthState }).getState(),
    provider: (next: typeof provider) => { provider = next; },
    me: (next: typeof me) => { me = next; },
    save: (next: typeof save) => { save = next; },
    request: () => onRequest({ headers: {} }),
    failure: (error: unknown) => onFailure(error),
    load,
  };
}

test('a confirmed mode switch clears mode-specific caches and cannot be undone by an older profile response', async () => {
  const cleared: string[] = [];
  let finishProfile!: (value: unknown) => void;
  const h = harness({
    '@/services/authService': {
      getMe: async () => ({ user: { id: 'account', name: 'Account' }, activeRole: 'rider', driverStatus: 'approved' }),
      switchActiveRole: async () => ({ activeRole: 'driver' }),
      saveProfile: () => new Promise(resolve => { finishProfile = resolve; }),
    },
    '@/store/tripStore': { useTripStore: { getState: () => ({ clear: () => { cleared.push('trip'); } }) } },
    '@/store/walletStore': { useWalletStore: { getState: () => ({ reset: () => { cleared.push('wallet'); } }) } },
    '@/store/mapStore': { useMapStore: { getState: () => ({ clearTripMap: () => { cleared.push('map'); } }) } },
    '@/store/courierDraftStore': { useCourierDraftStore: { getState: () => ({ clearDraft: () => { cleared.push('courier'); } }) } },
  });
  await h.tokens.setTokens({ accessToken: 'access', refreshToken: 'refresh' }); await h.auth().hydrate();
  cleared.length = 0;
  const oldProfile = h.auth().updateProfile({ name: 'Updated' });
  assert.equal(await h.auth().setRole('driver'), true);
  assert.ok(['trip', 'wallet', 'map', 'courier'].every(key => cleared.includes(key)));
  finishProfile({ user: { id: 'account', name: 'Updated' }, activeRole: 'rider' });
  await assert.rejects(oldProfile);
  assert.equal((h.auth().session as { user: { role: string } }).user.role, 'driver');
});

test('mode changes wait for the backend and duplicate submissions cannot race', async () => {
  let finish!: (value: unknown) => void;
  let requests = 0;
  const h = harness({ '@/services/authService': {
    getMe: async () => ({ user: { id: 'account', name: 'Account' }, activeRole: 'rider', driverStatus: 'approved' }),
    switchActiveRole: () => { requests += 1; return new Promise(resolve => { finish = resolve; }); },
  } });
  await h.tokens.setTokens({ accessToken: 'access', refreshToken: 'refresh' }); await h.auth().hydrate();
  const first = h.auth().setRole('driver');
  assert.equal((h.auth().session as { user: { role: string } }).user.role, 'rider');
  assert.equal(await h.auth().setRole('rider'), false); assert.equal(requests, 1);
  finish({ activeRole: 'driver' }); assert.equal(await first, true);
  assert.equal((h.auth().session as { user: { role: string } }).user.role, 'driver');
});

test('mobile refresh preserves sessions on outages and cannot restore credentials after logout', async (t) => {
  await t.test('concurrent HTTP/socket callers rotate once', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    let calls = 0;
    h.provider(async () => { calls += 1; return { data: { tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } } }; });
    await Promise.all([h.client.refreshAccessToken(), h.client.refreshAccessToken(), h.client.refreshAccessToken()]);
    assert.equal(calls, 1);
    assert.equal(await h.tokens.getRefreshToken(), 'new-refresh');
  });
  await t.test('network failure keeps credentials; a later retry succeeds', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    h.provider(async () => { throw new Error('network offline'); });
    await assert.rejects(h.client.refreshAccessToken(), /network offline/);
    assert.equal(await h.tokens.getRefreshToken(), 'old-refresh');
    h.provider(async () => ({ data: { tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } } }));
    await h.client.refreshAccessToken();
    assert.equal(await h.tokens.getRefreshToken(), 'new-refresh');
  });
  await t.test('revoked refresh clears credentials and notifies the app', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    let notifications = 0;
    h.client.subscribeSessionExpired(() => { notifications += 1; });
    h.provider(async () => { throw { isAxiosError: true, response: { status: 401 } }; });
    await assert.rejects(h.client.refreshAccessToken(), (error: unknown) => h.client.isSessionRejected(error));
    assert.equal(await h.tokens.getAccessToken(), null);
    assert.equal(await h.tokens.getRefreshToken(), null);
    assert.equal(notifications, 1);
  });
  await t.test('logout during an in-flight refresh cannot write old credentials back', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    let complete!: (value: { data: unknown }) => void;
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    h.provider(() => new Promise((resolve) => { complete = resolve; started(); }));
    const refresh = h.client.refreshAccessToken();
    await providerStarted;
    await h.tokens.clear();
    complete({ data: { tokens: { accessToken: 'late-access', refreshToken: 'late-refresh' } } });
    await assert.rejects(refresh, /account changed/);
    assert.equal(await h.tokens.getAccessToken(), null);
    assert.equal(await h.tokens.getRefreshToken(), null);
  });
  await t.test('offline hydration keeps credentials and recovers without a new login', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    h.me(async () => { throw new Error('offline'); });
    await h.auth().hydrate();
    assert.equal(h.auth()._hasHydrated, true);
    assert.ok(h.auth()._sessionError);
    assert.equal(await h.tokens.getRefreshToken(), 'old-refresh');
    h.me(async () => ({ user: { id: 'rider-one', name: 'Rider' }, activeRole: 'rider', driverStatus: 'none' }));
    await h.auth().hydrate();
    assert.ok(h.auth().session);
    assert.equal(h.auth()._sessionError, null);
  });
  await t.test('a late hydration response cannot reopen a logged-out account', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    let complete!: (value: unknown) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    h.me(() => new Promise((resolve) => { complete = resolve; started(); }));
    const hydration = h.auth().hydrate();
    await requestStarted;
    await h.auth().logout();
    complete({ user: { id: 'rider-one', name: 'Rider' }, activeRole: 'rider', driverStatus: 'none' });
    await hydration;
    assert.equal(h.auth().session, null);
    assert.equal(await h.tokens.getAccessToken(), null);
  });
  await t.test('an old account HTTP failure cannot be retried as the new account', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'first-access', refreshToken: 'first-refresh' });
    const config = await h.request();
    await h.tokens.setTokens({ accessToken: 'second-access', refreshToken: 'second-refresh' });
    let refreshed = false;
    h.provider(async () => { refreshed = true; throw new Error('Must not refresh the second account for the first request'); });
    await assert.rejects(h.failure({ config, response: { status: 401 }, isAxiosError: true }), /account changed/);
    assert.equal(refreshed, false);
    assert.equal(await h.tokens.getAccessToken(), 'second-access');
  });
  await t.test('profile save succeeds only after server persistence and cannot restore a logged-out user', async () => {
    const h = harness();
    await h.tokens.setTokens({ accessToken: 'access', refreshToken: 'refresh' });
    await h.auth().hydrate();
    h.save(async () => { throw new Error('offline'); });
    await assert.rejects(h.auth().updateProfile({ name: 'Unsaved' }), /offline/);
    assert.equal((h.auth().session as { user: { name: string } }).user.name, 'Rider');
    let complete!: (result: unknown) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    h.save(() => new Promise((resolve) => { complete = resolve; started(); }));
    const result = h.auth().updateProfile({ name: 'Updated' });
    const rejected = assert.rejects(result, /session changed/);
    await requestStarted;
    await h.auth().logout();
    complete({ user: { id: 'rider-one', name: 'Updated' }, activeRole: 'rider', driverStatus: 'none' });
    await rejected;
    assert.equal(h.auth().session, null);
  });
});

interface LocationModule {
  startDriverBackgroundUpdates: (driverId: string, tripId?: string) => Promise<void>;
  stopAllDriverLocationUpdates: () => Promise<void>;
}
test('background location startup cannot restore an old driver after logout', async (t) => {
  await t.test('logout clears a context write that was already in flight', async () => {
    const storage = new Map<string, string>();
    let finishWrite!: () => void;
    let writing!: () => void;
    const writeStarted = new Promise<void>((resolve) => { writing = resolve; });
    const writeAllowed = new Promise<void>((resolve) => { finishWrite = resolve; });
    let active = false;
    let starts = 0;
    const h = harness({
      '@/services/locationService': undefined,
      'expo-task-manager': { defineTask: () => undefined },
      'expo-device': { isDevice: true },
      '@react-native-async-storage/async-storage': { __esModule: true, default: {
        setItem: async (key: string, value: string) => { writing(); await writeAllowed; storage.set(key, value); },
        removeItem: async (key: string) => { storage.delete(key); },
      } },
      'expo-location': {
        Accuracy: { High: 1 },
        hasStartedLocationUpdatesAsync: async () => active,
        startLocationUpdatesAsync: async () => { starts++; active = true; },
        stopLocationUpdatesAsync: async () => { active = false; },
      },
    });
    const location = h.load('services/locationService.ts') as unknown as LocationModule;
    const oldStart = location.startDriverBackgroundUpdates('old-driver');
    await writeStarted;
    const logout = location.stopAllDriverLocationUpdates();
    finishWrite();
    await Promise.all([oldStart, logout]);
    assert.equal(storage.size, 0);
    assert.equal(active, false);
    assert.equal(starts, 0);
    await location.startDriverBackgroundUpdates('new-driver', 'new-trip');
    assert.equal(active, true);
    assert.equal(JSON.parse(storage.get('driver-location-context')!).driverId, 'new-driver');
    await location.stopAllDriverLocationUpdates();
  });
  await t.test('logout also stops a native startup that was already in flight', async () => {
    const storage = new Map<string, string>();
    let finishNative!: () => void;
    let starting!: () => void;
    const nativeStarted = new Promise<void>((resolve) => { starting = resolve; });
    const nativeAllowed = new Promise<void>((resolve) => { finishNative = resolve; });
    let active = false;
    const h = harness({
      'expo-task-manager': { defineTask: () => undefined },
      'expo-device': { isDevice: true },
      '@react-native-async-storage/async-storage': { __esModule: true, default: {
        setItem: async (key: string, value: string) => { storage.set(key, value); },
        removeItem: async (key: string) => { storage.delete(key); },
      } },
      'expo-location': {
        Accuracy: { High: 1 },
        hasStartedLocationUpdatesAsync: async () => active,
        startLocationUpdatesAsync: async () => { starting(); await nativeAllowed; active = true; },
        stopLocationUpdatesAsync: async () => { active = false; },
      },
    });
    const location = h.load('services/locationService.ts') as unknown as LocationModule;
    const oldStart = location.startDriverBackgroundUpdates('old-driver');
    await nativeStarted;
    const logout = location.stopAllDriverLocationUpdates();
    finishNative();
    await Promise.all([oldStart, logout]);
    assert.equal(active, false);
    assert.equal(storage.size, 0);
  });
});
