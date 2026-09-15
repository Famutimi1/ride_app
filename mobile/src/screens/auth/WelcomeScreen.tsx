/**
 * WelcomeScreen — the onboarding carousel: the app's front door for logged-out
 * users (route: "/welcome"). This is screen 1 in the design mockup.
 *
 * It's a horizontally-paged carousel (swipe or let it be — the dots track the
 * page). Each slide has an illustration slot on top and a heading + subtitle
 * below. A fixed footer holds the page dots, the "Get Started" CTA, and a "Log in"
 * link — those stay put while the slides swipe behind them.
 */
import { useRouter } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';

import { HeroIllustration } from './HeroIllustration';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

type Slide = {
  key: string;
  title: string;
  subtitle: string;
  image: React.ComponentProps<typeof HeroIllustration>['source'];
};

const SLIDES: Slide[] = [
  {
    key: 'anywhere',
    title: 'Get a ride anytime,\nanywhere',
    subtitle: 'Fast, reliable and safe rides\nat your fingertips.',
    image: require('@/assets/images/onboarding-ride.svg'),
  },
  {
    key: 'track',
    title: 'Track your driver\nin real time',
    subtitle: 'Watch your ride approach on a live map, every second of the way.',
    image: require('@/assets/images/onboarding-track.svg'),
  },
  {
    key: 'pay',
    title: 'Pay whichever\nway you like',
    subtitle: 'Cash, card or in-app wallet — settle up however suits you.',
    image: require('@/assets/images/onboarding-pay.svg'),
  },
  {
    key: 'ready',
    title: 'Ready when\nyou are',
    subtitle: 'Create your account and take your first trip in minutes.',
    image: require('@/assets/images/onboarding-ready.svg'),
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const isTallScreen = height >= 800;

  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < SLIDES.length) {
      setIndex(next);
    }
  };

  return (
    <StyledSafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <View className="flex-1 justify-between">
        {/* Horizontal Carousel */}
        <ScrollView
          className="flex-1"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
        >
          {SLIDES.map((item) => (
            <View
              key={item.key}
              className="w-screen flex-1 justify-start px-xl pt-[63px]"
            >
              <View className="h-[210px] w-full items-center justify-center">
                <HeroIllustration source={item.image} />
              </View>

              <View className="mt-md gap-sm">
                <Text
                  variant="h2"
                  className={isTallScreen
                    ? '!font-inter-bold !text-[28px] !leading-[34px] tracking-[-0.3px]'
                    : '!font-inter-bold !text-[20px] !leading-[23px] tracking-[-0.2px]'}
                >
                  {item.title}
                </Text>
                <Text
                  variant="body"
                  color="textMuted"
                  className={isTallScreen ? '!text-[16px] !leading-[24px]' : '!text-[14px] !leading-[20px]'}
                >
                  {item.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Fixed footer: pagination dots + primary CTA + log-in link */}
        <View className="mb-[68px] w-full px-[20px]">
          {/* Pagination dots (centered row) */}
          <View className="mb-2xl flex-row items-center justify-center gap-[12px]">
            {SLIDES.map((s, i) => {
              const active = i === index;
              return (
                <View
                  key={s.key}
                  className={`h-[7px] w-[7px] rounded-full ${active ? 'bg-primary' : 'bg-border'}`}
                />
              );
            })}
          </View>

          {/* Get Started CTA */}
          <Button
            label="Get Started"
            size="lg"
            fullWidth
            className="h-[40px] rounded-[13px]"
            onPress={() => router.push('/phone')}
          />

          {/* Already have an account? Log in */}
          <View className="mt-lg flex-row items-center justify-center gap-[6px]">
            <Text
              variant="caption"
              color="textMuted"
              className={isTallScreen ? '!text-[14px] !leading-[20px]' : '!text-[12px] !leading-[18px]'}
            >
              Already have an account?
            </Text>
            <Pressable
              onPress={() => router.push('/phone')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                variant="caption"
                color="primary"
                className={isTallScreen
                  ? '!text-[14px] !font-medium !leading-[20px]'
                  : '!text-[12px] !font-medium !leading-[18px]'}
              >
                Log in
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </StyledSafeAreaView>
  );
}
