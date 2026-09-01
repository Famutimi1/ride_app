/**
 * WelcomeScreen — the onboarding carousel: the app's front door for logged-out
 * users (route: "/welcome"). This is screen 1 in the design mockup.
 *
 * It's a horizontally-paged carousel (swipe or let it be — the dots track the
 * page). Each slide has an illustration slot on top and a heading + subtitle
 * below. A fixed footer holds the page dots, the "Get Started" CTA, and a "Log in"
 * link — those stay put while the slides swipe behind them.
 *
 * We use a paging ScrollView (not FlatList): there are only four static slides, so
 * virtualisation buys nothing, and ScrollView keeps the typings clean.
 *
 * The hero artwork isn't in the project yet, so HeroIllustration renders a blank
 * themed box for now; drop images into assets/images later and pass them to each
 * slide's `image` prop (see SLIDES below).
 *
 * Auth note: sign-in here is phone + OTP, so "Get Started" and "Log in" both go to
 * the same phone screen — a new number gets a profile, a returning one drops
 * straight home. There's no separate login form to route to.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

import { HeroIllustration } from './HeroIllustration';

// Each slide's copy. `image` is left undefined for now → blank hero slot; add
// `image: require('@/assets/images/xyz.png')` per slide when the art is ready.
type Slide = {
  key: string;
  title: string;
  subtitle: string;
  image?: React.ComponentProps<typeof HeroIllustration>['source'];
};

const SLIDES: Slide[] = [
  {
    key: 'anywhere',
    title: 'Get a ride anytime,\nanywhere',
    subtitle: 'Fast, reliable and safe rides at your fingertips.',
  },
  {
    key: 'track',
    title: 'Track your driver\nin real time',
    subtitle: 'Watch your ride approach on a live map, every second of the way.',
  },
  {
    key: 'pay',
    title: 'Pay whichever\nway you like',
    subtitle: 'Cash, card or in-app wallet — settle up however suits you.',
  },
  {
    key: 'ready',
    title: 'Ready when\nyou are',
    subtitle: 'Create your account and take your first trip in minutes.',
  },
];

export function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [index, setIndex] = useState(0);

  // Which page are we on? Round the horizontal offset to the nearest slide width.
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex: 1 }}>
        {/* The swiping part. Each slide is exactly one screen wide so paging snaps
            cleanly; the slide pads its own content. */}
        <ScrollView
          style={{ flex: 1 }}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
        >
          {SLIDES.map((item) => (
            <View key={item.key} style={{ width, paddingHorizontal: theme.spacing.xl }}>
              <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing['2xl'] }}>
                <HeroIllustration source={item.image} />
                <View style={{ gap: theme.spacing.sm }}>
                  <Text variant="h2">{item.title}</Text>
                  <Text variant="body" color="textMuted">
                    {item.subtitle}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Fixed footer: page dots + primary CTA + log-in link. */}
        <View style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.lg }}>
          {/* Pagination dots — the active one stretches into a pill and turns blue. */}
          <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
            {SLIDES.map((s, i) => {
              const active = i === index;
              return (
                <View
                  key={s.key}
                  style={{
                    height: 8,
                    width: active ? 22 : 8,
                    borderRadius: theme.radius.full,
                    backgroundColor: active ? theme.colors.primary : theme.colors.border,
                  }}
                />
              );
            })}
          </View>

          <Button label="Get Started" fullWidth onPress={() => router.push('/phone')} />

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.xs }}>
            <Text variant="caption" color="textMuted">
              Already have an account?
            </Text>
            <Text variant="caption" color="primary" onPress={() => router.push('/phone')}>
              Log in
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
