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
import { cssInterop } from 'nativewind';
import { View } from 'react-native';

import { Text } from './Text';

type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  uri?: string | null;
  /** Full name — used to derive initials for the fallback. */
  name?: string;
  size?: AvatarSize;
}

const DIMENSION_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
};

const StyledImage = cssInterop(Image, { className: 'style' });

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
  const circleClass = `${DIMENSION_CLASSES[size]} rounded-full`;

  if (uri) {
    return (
      <StyledImage
        source={{ uri }}
        className={circleClass}
        contentFit="cover"
        // Smooth fade instead of a hard pop when the photo loads in.
        transition={150}
      />
    );
  }

  return (
    <View className={`${circleClass} items-center justify-center bg-primarySoft`}>
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
