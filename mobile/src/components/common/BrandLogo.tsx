import { Image } from 'expo-image';
import { View } from 'react-native';

/** Display the supplied mark without modifying its pixels or transparent source. */
export function BrandLogo({ size = 120 }: { size?: number }) {
  // The 1501px source includes generous transparent margins. This layout window
  // centers the visible shield, retaining 24px of clear space around its edges.
  const scale = size / 1040;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image
        source={require('@/assets/images/brand/rakky-ride-logo.png')}
        accessibilityLabel="Rakky Ride"
        accessible
        contentFit="contain"
        style={{
          position: 'absolute',
          width: 1501 * scale,
          height: 1501 * scale,
          left: -210 * scale,
          top: -280 * scale,
        }}
      />
    </View>
  );
}
