/**
 * Avatar — a circular profile image with an initials fallback.
 *
 * If `uri` is given it shows the photo (via expo-image, which is faster and
 * caches better than RN's Image). If not, it shows the person's initials on a
 * tinted circle — so a driver/rider with no photo still looks intentional.
 *
 * Usage:
 *   <Avatar uri={driver.photoUrl} name="Chidi Okeke" />
 *   <Avatar name="Ada N" size="lg" />
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  uri?: string | null;
  /** Full name — used to derive initials for the fallback. */
  name?: string;
  size?: AvatarSize;
}

const DIMENSIONS: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 64 };

/** "Chidi Okeke" → "CO", "Ada" → "A". Guards against empty/whitespace names. */
function initialsOf(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ uri, name, size = 'md' }: AvatarProps) {
  const theme = useTheme();
  const dimension = DIMENSIONS[size];
  const circle = {
    width: dimension,
    height: dimension,
    borderRadius: theme.radius.full,
  };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={circle}
        contentFit="cover"
        // Smooth fade instead of a hard pop when the photo loads in.
        transition={150}
      />
    );
  }

  return (
    <View
      style={[
        circle,
        styles.fallback,
        { backgroundColor: theme.colors.primarySoft },
      ]}
    >
      <Text
        // Scale the initials with the circle; larger avatars get an h-level size.
        variant={size === 'lg' ? 'h3' : 'bodyMedium'}
        color="primary"
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
