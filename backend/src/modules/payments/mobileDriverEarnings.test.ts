import { mobileFeedbackDependency } from '../../shared/testing/mobileFeedback';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

type Props = Record<string, unknown>;
interface Element { type: string | ((props: Props) => Element); props: Props }
const mobileRequire = createRequire(resolve('../mobile/package.json'));
const ts = mobileRequire('typescript') as { transpileModule: (source: string, options: object) => { outputText: string }; ModuleKind: { CommonJS: number }; ScriptTarget: { ES2022: number }; JsxEmit: { ReactJSX: number } };
const jsx = (type: Element['type'], props: Props): Element => ({ type, props });
function load<T>(path: string, mocks: Props = {}): T {
  const exports: Props = {};
  const code = ts.transpileModule(readFileSync(resolve('../mobile/src', path), 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { const feedbackModule = mobileFeedbackDependency(name); if (feedbackModule) return feedbackModule;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports as T;
}
function nodes(root: unknown): Element[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const node = root as Element;
  if (typeof node.type === 'function') return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
function copy(root: Element): string {
  return nodes(root).filter(node => node.type === 'Text').map(node => {
    const flatten = (value: unknown): string => Array.isArray(value) ? value.map(flatten).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    return flatten(node.props.children);
  }).join('\n');
}
const summary = { range: 'today', trips: 1, grossKobo: 1634700, commissionKobo: 245205, netKobo: 1389495, cashTrips: 1, walletTrips: 0, cashCollectedKobo: 1634700, cashEarningsKobo: 1389495, walletEarningsKobo: 0, cashCommissionKobo: 245205 };
const payment = load('services/paymentService.ts', { '@/lib/apiClient': { apiClient: {} } });
const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 28 };
const mocks = {
  react: {}, 'react-native': { View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ height: 804 }) },
  'expo-router': {}, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
  '@/components/map': {}, '@/components/map/HomeLocationFallback': {}, '@/components/common': { Text: 'Text', Button: 'Button' },
  '@/components/common/RideIcon': { RideIcon: 'RideIcon' }, '@/components/common/DriverServiceSettings': {},
  '@/constants/theme': { useTheme: () => ({ colors: {} }), spacing, radius: {}, borderWidths: { divider: 1 } },
  '@/store/authStore': {}, '@/store/mapStore': {}, '@/store/walletStore': {}, '@/services/paymentService': payment,
};
const { DriverDashboardView } = load<{ DriverDashboardView: (props: Props) => Element }>('screens/driver/DriverDashboardScreen.tsx', mocks);

test('driver home shows positive total income and links to detailed earnings without financial clutter', () => {
  let opened = false;
  let tripsOpened = false;
  const view = DriverDashboardView({ title: 'Driver home', locationAvailable: true, earnings: summary, owedKobo: 245205, walletLoading: false, onEarnings: () => { opened = true; }, onTrips: () => { tripsOpened = true; } });
  const text = copy(view);
  assert.match(text, /Today’s earnings\n₦13,894\.95/);
  assert.match(text, /Trips today\n1/);
  for (const removed of ['Cash earnings', 'Wallet earnings', 'Cash collected', 'Available in driver wallet', 'Commission to repay', 'Ready when you are', 'Rating', 'Online']) assert.equal(text.includes(removed), false);
  assert.equal(text.includes('−'), false);
  const details = nodes(view).find(node => node.props.accessibilityLabel === 'View earnings');
  assert.ok(details); (details.props.onPress as () => void)(); assert.equal(opened, true);
  const trips = nodes(view).find(node => node.props.accessibilityLabel === 'View trip history');
  assert.ok(trips); (trips.props.onPress as () => void)(); assert.equal(tripsOpened, true);
});

test('a wallet credit that covers commission does not turn historic commission into current debt', () => {
  const text = copy(DriverDashboardView({ title: 'Driver home', locationAvailable: true, earnings: summary, owedKobo: 0, walletLoading: false }));
  assert.equal(text.includes('₦2,452.05'), false);
  assert.equal(text.includes('Review wallet to go online'), false);
});

test('a blocking commission limit still offers a direct wallet action', () => {
  let opened = false;
  const view = DriverDashboardView({ title: 'Driver home', locationAvailable: true, earnings: summary, owedKobo: 245205, debtBlocked: true, onWallet: () => { opened = true; } });
  assert.match(copy(view), /₦2,452\.05 commission outstanding/);
  const warning = nodes(view).find(node => node.props.accessibilityLabel === 'Review commission limit in driver wallet');
  assert.ok(warning); (warning.props.onPress as () => void)(); assert.equal(opened, true);
});

test('earnings breakdown distinguishes period commission from current outstanding debt', () => {
  const { DriverEarningsView } = load<{ DriverEarningsView: (props: Props) => Element }>('screens/shared/DriverFinanceScreens.tsx', {
    ...mocks, '@/hooks/useFinanceResource': {}, '@/lib/apiClient': {},
    './DriverFinanceUI': { FinancePage: 'FinancePage', FinanceCard: 'FinanceCard', MoneySummary: 'MoneySummary', financeStyles: {} },
  });
  const view = DriverEarningsView({ range: 'today', summary: { data: summary, loading: false, error: null } });
  const text = copy(view);
  assert.match(text, /Cash earnings after commission\n₦13,894\.95/);
  assert.match(text, /Wallet earnings after commission\n₦0/);
  assert.match(text, /Cash-trip commission for this period\n₦2,452\.05/);
  assert.match(text, /may already be settled/);
  assert.equal(nodes(view).find(node => node.type === 'MoneySummary')?.props.amount, 1389495);
  assert.equal(text.includes('Net includes wallet earnings less cash-trip commission'), false);
});
