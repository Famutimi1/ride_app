import { svgDataUri } from '@/utils/svgDataUri';
import { Image } from 'expo-image';
import { View } from 'react-native';

import type { AppColors } from '@/constants/colors';
import { useTheme } from '@/constants/theme';

type HomeIconName = 'menu' | 'search' | 'calendar' | 'locate' | 'sun' | 'moon' | 'history' | 'safety' | 'chevron';

const SHAPES: Record<HomeIconName, string> = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-11 4h.01M12 14h.01M15 14h.01"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
  history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2"/>',
  safety: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};

/** Decorative outlines; the containing control supplies its accessible label. */
export function HomeIcon({ name, size = 20, color = 'text' }: { name: HomeIconName; size?: number; color?: keyof AppColors }) {
  const { colors } = useTheme();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors[color]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SHAPES[name]}</svg>`;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: size, height: size }}>
      <Image source={{ uri: svgDataUri(svg) }} contentFit="contain" style={{ width: size, height: size }} />
    </View>
  );
}
