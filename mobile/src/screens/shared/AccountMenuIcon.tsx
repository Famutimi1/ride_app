import { Image } from 'expo-image';
import { View } from 'react-native';

import { useTheme } from '@/constants/theme';

export type MenuIconName = 'history' | 'payment' | 'services' | 'notifications' | 'safety' | 'support' | 'settings' | 'wallet' | 'documents' | 'close' | 'chevron';

// Small code-native outlines keep the menu consistent without adding an icon library.
const SHAPES: Record<MenuIconName, string> = {
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l3.5 2"/>',
  payment: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>',
  services: '<path d="m5 9 1.5-4h11L19 9M4 17V11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6H4ZM4 17v3h3v-3m10 0v3h3v-3M7 13h1m8 0h1"/>',
  notifications: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 20a2 2 0 0 0 4 0M12 3v1"/>',
  safety: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  support: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2l-1.5 1v2"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/>',
  settings: '<path d="m10 3-.5 2-1.5.8-2-.6-2 3.5 1.5 1.5v1.6L4 13.3l2 3.5 2-.6 1.5.8.5 2h4l.5-2 1.5-.8 2 .6 2-3.5-1.5-1.5v-1.6L20 8.7l-2-3.5-2 .6-1.5-.8-.5-2Z"/><circle cx="12" cy="11" r="3"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M5 6V4h13v2m3 5h-6v5h6"/><circle cx="17.5" cy="13.5" r=".5" fill="currentColor" stroke="none"/>',
  documents: '<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};

export function AccountMenuIcon({ name, size = 24 }: { name: MenuIconName; size?: number }) {
  const { colors } = useTheme();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors.text}" color="${colors.text}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SHAPES[name]}</svg>`;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: size, height: size }}>
      <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }} contentFit="contain" style={{ width: size, height: size }} />
    </View>
  );
}
