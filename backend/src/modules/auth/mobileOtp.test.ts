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
interface Element { type: string; props: Props }
const flush = () => new Promise<void>(done => setImmediate(done));

/** Actual mobile controller with isolated network, navigation and countdown. */
function harness(options: { phone?: string | null; intent?: string; verify?: (code: string) => Promise<{ destination: string }>; resend?: (phone: string) => Promise<void> } = {}) {
  const slots: unknown[] = []; let cursor = 0;
  let timers: Array<() => void> = [];
  const routes: string[] = [], verifies: string[] = [], resends: string[] = [];
  const phone = options.phone === undefined ? '+2348000006789' : options.phone;
  const auth = { pending: phone ? { phone, intent: options.intent ?? 'login' } : null,
    verifyOtp: async (code: string) => { verifies.push(code); return options.verify ? options.verify(code) : { destination: 'home' }; },
    requestOtp: async (value: string) => { resends.push(value); await options.resend?.(value); },
  };
  const jsx = (type: string, props: Props) => ({ type, props });
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next: unknown) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useEffect(effect: () => void) { effect(); },
    },
    'react-native': {}, 'expo-router': { Redirect: 'Redirect', useRouter: () => ({ replace: (path: string) => routes.push(path) }) },
    '@/store/authStore': { useAuthStore: (select: (state: typeof auth) => unknown) => select(auth) },
    './OtpVerificationView': { OtpVerificationView: 'OtpVerificationView' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  };
  const exports: Props = {};
  const source = readFileSync(resolve('../mobile/src/screens/auth/OtpScreen.tsx'), 'utf8');
  const code = compiler.transpileModule(source, { compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022, jsx: compiler.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, Error, require: (name: string) => { const feedbackModule = mobileFeedbackDependency(name); if (feedbackModule) return feedbackModule; if (name in modules) return modules[name]; throw new Error(`Unexpected OTP dependency ${name}`); }, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined, requestAnimationFrame: (fn: () => void) => fn() });
  const render = () => { cursor = 0; timers = []; return (exports.OtpScreen as () => Element)(); };
  const advance = (seconds: number) => { for (let i = 0; i < seconds; i++) { render(); timers[0]?.(); } };
  return { render, advance, routes, verifies, resends };
}
const action = (view: Element, name: string) => (view.props[name] as () => void)();
const change = (view: Element, value: string) => (view.props.onCodeChange as (value: string) => void)(value);

test('OTP paste normalizes six digits and prevents concurrent auto-submit and button requests', async () => {
  let complete!: (value: { destination: string }) => void;
  const job = new Promise<{ destination: string }>(done => { complete = done; });
  const h = harness({ verify: () => job });
  change(h.render(), '12a3456');
  const busy = h.render();
  assert.equal(busy.props.code, '123456'); assert.equal(busy.props.loading, true);
  action(busy, 'onVerify'); change(busy, '999999'); action(busy, 'onResend'); action(busy, 'onChangeNumber');
  assert.deepEqual(h.verifies, ['123456']); assert.deepEqual(h.resends, []); assert.deepEqual(h.routes, []);
  complete({ destination: 'driver-dashboard' }); await flush();
  assert.deepEqual(h.routes, ['/driver-dashboard']); assert.equal(h.render().props.loading, false);
});

test('OTP rejection clears the code and displays a recoverable error', async () => {
  const h = harness({ verify: async () => { throw new Error('Code expired'); } });
  change(h.render(), '123'); action(h.render(), 'onVerify'); assert.equal(h.verifies.length, 0);
  change(h.render(), '123456'); await flush();
  const error = h.render();
  assert.equal(error.props.code, ''); assert.equal(error.props.loading, false); assert.equal(error.props.error, 'Verification failed. Try again.');
  change(error, '4'); assert.equal(h.render().props.error, undefined);
});

test('resend honors cooldown, displays failures and restarts the countdown only on success', async () => {
  let fail = true;
  const h = harness({ resend: async () => { if (fail) throw new Error('SMS unavailable'); } });
  action(h.render(), 'onResend'); assert.equal(h.resends.length, 0);
  h.advance(60); assert.equal(h.render().props.seconds, 0);
  action(h.render(), 'onResend'); await flush();
  assert.equal(h.render().props.error, 'Could not resend your code. Try again.'); assert.equal(h.render().props.resending, false); assert.equal(h.render().props.seconds, 0);
  fail = false; action(h.render(), 'onResend'); action(h.render(), 'onResend'); await flush();
  assert.deepEqual(h.resends, ['+2348000006789', '+2348000006789']);
  assert.equal(h.render().props.seconds, 60); assert.equal(h.render().props.error, undefined);
});

test('a missing phone redirects and change-number preserves login and registration destinations', () => {
  const missing = harness({ phone: null }).render(); assert.equal(missing.type, 'Redirect'); assert.equal(missing.props.href, '/phone');
  for (const [intent, path] of [['login', '/login'], ['register', '/phone']]) {
    const h = harness({ intent }); action(h.render(), 'onChangeNumber'); assert.deepEqual(h.routes, [path]);
  }
});
