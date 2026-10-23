import { svgDataUri } from '@/utils/svgDataUri';
import { Image } from 'expo-image';
import { View } from 'react-native';

import type { AppColors } from '@/constants/colors';
import { useTheme } from '@/constants/theme';

type RideIconName = 'car' | 'package' | 'receipt' | 'plate' | 'passenger' | 'cash' | 'wallet' | 'card' | 'check' | 'down' | 'chevron' | 'close' | 'safety' | 'distance' | 'clock' | 'vehicle' | 'plus' | 'incoming' | 'outgoing' | 'lock' | 'unlock' | 'external' | 'support' | 'bell' | 'tag' | 'phone' | 'share' | 'seatbelt' | 'trusted' | 'refresh' | 'mail' | 'minus' | 'sun' | 'moon' | 'device' | 'location' | 'calendar' | 'sound' | 'vibration' | 'logout' | 'menu' | 'swap' | 'trash' | 'bank' | 'earnings' | 'coins' | 'id-card' | 'info' | 'motorcycle' | 'upload';

const SHAPES: Record<Exclude<RideIconName, 'car'>, string> = {
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  'id-card': '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M4.5 17v-1a3.5 3.5 0 0 1 7 0v1M15 9h4m-4 4h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  motorcycle: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m19 17-4-13h-4m4 5H9l-4 8h7l5-8M7 8H4"/>',
  coins: '<ellipse cx="15" cy="5" rx="6" ry="3"/><path d="M9 5v5c0 2 12 2 12 0V5M13 13c4 1 8-1 8-3v5c0 2-4 3-8 3"/><ellipse cx="8" cy="15" rx="6" ry="3"/><path d="M2 15v5c0 4 12 4 12 0v-5"/>',
  bank: '<path d="m2 8 10-6 10 6H2Zm1 13h18M5 10v8m5-8v8m4-8v8m5-8v8"/>',
  earnings: '<path d="M3 21V11h4v10H3Zm7 0V6h4v15h-4Zm7 0V2h4v19h-4Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  swap: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
  device: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  location: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h3"/>',
  sound: '<path d="M4 9h4l5-5v16l-5-5H4V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  vibration: '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="m3 6-1 3 2 3-2 3 1 3m18-12 1 3-2 3 2 3-1 3M11 17h2"/>',
  logout: '<path d="M10 3H4v18h6m4-14 5 5-5 5M8 12h13"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m3 6 9 7 9-7"/>',
  minus: '<path d="M5 12h14"/>',
  phone: '<path d="m6 3 4 5-2 3a16 16 0 0 0 5 5l3-2 5 4-2 3c-1 2-7 0-12-5S0 5 3 3h3Z"/>',
  share: '<path d="m14 3 8 7-8 7v-5C8 12 5 15 2 20c0-9 4-14 12-14V3Z"/>',
  seatbelt: '<path d="m14 2 4 2-6 9-4-2 6-9ZM7 13l4 2-4 7-4-2 4-7Z"/><rect x="7" y="10" width="7" height="6" rx="1" transform="rotate(32 10.5 13)"/>',
  trusted: '<circle cx="8" cy="6" r="3"/><path d="M2 20v-3a6 6 0 0 1 9-5m6-2 5 2v4c0 3-3 5-5 6-2-1-5-3-5-6v-4l5-2Z"/>',
  bell: '<path d="M5 9a7 7 0 0 1 14 0c0 8 3 8 3 9H2c0-1 3-1 3-9Zm4 12h6"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  incoming: '<path d="M19 5 5 19M5 7v12h12"/>',
  outgoing: '<path d="M5 19 19 5M7 5h12v12"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  support: '<path d="M4 14v-3a8 8 0 0 1 16 0v3m-16-2H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Zm0 7a3 3 0 0 1-3 3h-3"/>',
  receipt: '<path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7m-7 4h5"/>',
  plate: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10v4m3-4v4m3-4h2m-2 4h2m3-4h1m-1 4h1"/>',
  package: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7.5 4.5l9 5v5"/>',
  distance: '<path d="M7 3 3 21M17 3l4 18M12 3v3m0 5v3m0 5v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  vehicle: '<path d="m5 9 1.5-4h11L19 9M4 17v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6H4Zm0 0v3h3v-3m10 0v3h3v-3M7 13h1m8 0h1"/>',
  passenger: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3H5Z"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 9a4 4 0 0 0 4-4m12 0a4 4 0 0 0 4 4M2 15a4 4 0 0 1 4 4m12 0a4 4 0 0 1 4-4"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M5 6V4h13v2m3 5h-6v5h6"/><circle cx="17.5" cy="13.5" r=".5" fill="currentColor" stroke="none"/>',
  card: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  down: '<path d="m5 8 7 7 7-7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  safety: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
};

/** Small conventional symbols, with the same generic sedan used throughout booking. */
export function RideIcon({ name, size = 18, color = 'text' }: { name: RideIconName; size?: number; color?: keyof AppColors }) {
  const { colors } = useTheme();
  const height = name === 'car' ? size * 0.55 : size;
  const shape = name === 'car'
    ? '<path fill="currentColor" stroke="none" d="m4 14 9-2 8-7h18l11 8 9 2 3 4v6h-6a7 7 0 0 0-14 0H21a7 7 0 0 0-14 0H2v-7l2-4Zm13-1h12V8h-7l-5 5Zm15 0h13l-8-5h-5v5Z"/><circle cx="14" cy="25" r="4"/><circle cx="49" cy="25" r="4"/>'
    : SHAPES[name];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="${name === 'car' ? '0 0 64 34' : '0 0 24 24'}" fill="none" color="${colors[color]}" stroke="${colors[color]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: size, height }}>
    <Image source={{ uri: svgDataUri(svg) }} contentFit="contain" style={{ width: size, height }} />
  </View>;
}
