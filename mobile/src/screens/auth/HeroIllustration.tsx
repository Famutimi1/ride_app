/**
 * HeroIllustration — the artwork slot at the top of each onboarding slide (the blue
 * car + location pin + skyline in the mockup).
 *
 * We don't have the artwork yet, so by default this renders an EMPTY themed box of
 * the right size — a clean placeholder that reserves the space. When the real image
 * is ready, drop it into assets/images and pass it in:
 *
 *   <HeroIllustration source={require('@/assets/images/onboarding-ride.png')} />
 *
 * Keeping the swap here (one component) means the onboarding screen never changes.
 */
import { Image } from 'expo-image';
import { View } from 'react-native';

import { useTheme } from '@/constants/theme';

// Borrow expo-image's own `source` type so `require(...)` and { uri } both work.
type HeroSource = React.ComponentProps<typeof Image>['source'];

export function HeroIllustration({ source }: { source?: HeroSource }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: '100%',
        // Wide, landscape hero area matching the mockup's proportions.
        aspectRatio: 1.35,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surfaceMuted,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {source ? (
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          transition={200}
        />
      ) : null}
    </View>
  );
}
