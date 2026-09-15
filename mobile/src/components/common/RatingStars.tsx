/**
 * RatingStars — shows a 0–5 star rating, and can optionally collect one.
 *
 * Stars use the amber `warning` colour — the mockup reserves amber specifically
 * for ratings (and warnings), never as a general accent.
 *
 * We draw the star with a Unicode glyph (★) rather than pulling in an icon
 * library, to avoid adding a dependency before it's needed. If we later adopt
 * @expo/vector-icons for the app's icons, swap the glyph here for <Ionicons
 * name="star" /> — the component's API won't change.
 *
 * Usage:
 *   <RatingStars value={4.8} />                       // read-only display
 *   <RatingStars value={rating} interactive onChange={setRating} />
 */
import { vars } from 'nativewind';
import { Pressable, View } from 'react-native';

import { Text } from './Text';

export interface RatingStarsProps {
  /** Current rating. Fractional values (4.8) are rounded for the star display. */
  value: number;
  max?: number;
  /** Glyph size in px. Defaults to 20. */
  size?: number;
  /** When true, tapping a star reports the new rating via onChange. */
  interactive?: boolean;
  onChange?: (value: number) => void;
}

export function RatingStars({
  value,
  max = 5,
  size = 20,
  interactive = false,
  onChange,
}: RatingStarsProps) {
  const filledCount = Math.round(value);
  const starSize = vars({
    '--star-size': `${size}px`,
    '--star-line-height': `${size + 2}px`,
  });

  return (
    <View
      className="flex-row gap-[2px]"
      style={starSize}
      accessibilityLabel={`${value} out of ${max} stars`}
    >
      {Array.from({ length: max }, (_, i) => {
        const filled = i < filledCount;
        // Same glyph whether filled or not — only the colour changes — so the
        // stars keep identical widths and stay perfectly aligned.
        const star = (
          <Text
            color={filled ? 'warning' : 'borderStrong'}
            className="!text-[length:var(--star-size)] !leading-[var(--star-line-height)]"
          >
            ★
          </Text>
        );

        if (!interactive) {
          return <View key={i}>{star}</View>;
        }

        return (
          <Pressable
            key={i}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${i + 1} star${i === 0 ? '' : 's'}`}
            onPress={() => onChange?.(i + 1)}
          >
            {star}
          </Pressable>
        );
      })}
    </View>
  );
}
