import { Image } from 'expo-image';
import { View } from 'react-native';

import type { AppColors } from '@/constants/colors';
import { useTheme } from '@/constants/theme';

type AddressIconName = 'back' | 'pickup' | 'pin' | 'swap' | 'close' | 'locate' | 'edit';

const SHAPES: Record<AddressIconName, string> = {
  back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
  pickup: '<circle cx="12" cy="12" r="8"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  swap: '<path d="M8 20V4m-4 4 4-4 4 4m4-4v16m-4-4 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14l-1 6Z"/>',
};

export function AddressIcon({ name, size = 18, color = 'text' }: { name: AddressIconName; size?: number; color?: keyof AppColors }) {
  const { colors } = useTheme();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors[color]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SHAPES[name]}</svg>`;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: size, height: size }}>
    <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }} contentFit="contain" style={{ width: size, height: size }} />
  </View>;
}
