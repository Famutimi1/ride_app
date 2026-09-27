/**
 * HeroIllustration — the artwork slot at the top of each onboarding slide (the green
 * car + location pin + skyline in the mockup).
 *
 * It renders the vector artwork seamlessly with contain mode, allowing custom
 * slide illustrations to be passed in or defaulting to the ride illustration.
 */
import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { View } from 'react-native';

const DEFAULT_HERO = require('@/assets/images/onboarding-ride.svg');
const StyledImage = cssInterop(Image, { className: 'style' });

// Borrow expo-image's own `source` type so `require(...)` and { uri } both work.
type HeroSource = React.ComponentProps<typeof Image>['source'];

export function HeroIllustration({ source = DEFAULT_HERO }: { source?: HeroSource }) {
  return (
    <View className="aspect-[1.3] w-full items-center justify-center">
      <StyledImage
        source={source}
        className="h-full w-full"
        contentFit="contain"
        transition={200}
      />
    </View>
  );
}
