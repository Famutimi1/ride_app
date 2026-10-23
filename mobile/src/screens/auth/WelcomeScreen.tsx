import { svgDataUri } from '@/utils/svgDataUri';
/** Three short benefit-led pages, based on the generated full-page design studies. */
import { Image, type ImageSource } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLogo, Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

type Slide = {
  key: string;
  title: string;
  description: string;
  image: ImageSource;
  imageLabel: string;
};

const SLIDES: Slide[] = [
  {
    key: 'ride',
    title: 'Your next ride,\nmade easy.',
    description: 'Choose your destination. We’ll take care of the journey.',
    image: require('@/assets/images/onboarding-v3/ride.png'),
    imageLabel: 'A soft 3D green car with a location pin and little city buildings',
  },
  {
    key: 'delivery',
    title: 'Small package.\nBig possibilities.',
    description: 'Send parcels across the city, without the extra hassle.',
    image: require('@/assets/images/onboarding-v3/delivery.png'),
    imageLabel: 'Two soft 3D parcels with green ribbons and a curved delivery arrow',
  },
  {
    key: 'payment',
    title: 'Pay your way.',
    description: 'Choose cash, card, or wallet when you book.',
    image: require('@/assets/images/onboarding-v3/payment.png'),
    imageLabel: 'Simple 3D green and ivory payment cards with a mint confirmation check',
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableHeight = height - insets.top - insets.bottom;
  const frameWidth = Math.min(width, 460);
  const pageWidth = frameWidth - 48;
  const illustrationHeight = Math.max(180, Math.min(290, availableHeight * 0.34));
  const [copyHeight, setCopyHeight] = useState(164);
  const pageHeight = Math.max(availableHeight - 252, illustrationHeight + copyHeight + 20);
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const currentIndex = useRef(0);
  const lastSlide = index === SLIDES.length - 1;

  useEffect(() => {
    pager.current?.scrollTo({ x: currentIndex.current * pageWidth, animated: false });
  }, [pageWidth]);

  const selectSlide = (next: number) => {
    currentIndex.current = next;
    setIndex(next);
    pager.current?.scrollTo({ x: next * pageWidth, animated: true });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    if (next >= 0 && next < SLIDES.length && next !== currentIndex.current) {
      currentIndex.current = next;
      setIndex(next);
    }
  };

  const glow = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="320" viewBox="0 0 400 320"><defs><radialGradient id="halo"><stop stop-color="${colors.primarySoft}"/><stop offset="1" stop-color="${colors.background}" stop-opacity="0"/></radialGradient></defs><ellipse cx="200" cy="160" rx="200" ry="160" fill="url(#halo)"/></svg>`);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.outerContent}>
        <View style={{ width: frameWidth, minHeight: availableHeight, paddingHorizontal: 24, paddingBottom: 16 }}>
          <View style={styles.header}>
            <View style={styles.brand}>
              <BrandLogo size={36} />
              <Text variant="bodyMedium">Rakky Ride</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Skip onboarding" onPress={() => router.push('/phone')} style={styles.skip}>
              <Text variant="caption" color="textMuted">Skip</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            style={{ width: pageWidth, height: pageHeight, flexGrow: 0 }}
          >
            {SLIDES.map((slide, slideIndex) => (
              <View
                key={slide.key}
                accessibilityElementsHidden={slideIndex !== index}
                importantForAccessibility={slideIndex === index ? 'auto' : 'no-hide-descendants'}
                aria-hidden={slideIndex !== index}
                style={{ width: pageWidth, height: pageHeight, justifyContent: 'center' }}
              >
                <View style={[styles.artwork, { height: illustrationHeight }]}>
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <Image source={{ uri: glow }} contentFit="fill" style={StyleSheet.absoluteFill} />
                  </View>
                  <Image
                    source={slide.image}
                    accessibilityLabel={slide.imageLabel}
                    contentFit="contain"
                    style={{ width: '100%', maxWidth: 340, height: '100%' }}
                  />
                </View>
                <View
                  onLayout={({ nativeEvent }) => setCopyHeight((previous) => Math.max(previous, Math.ceil(nativeEvent.layout.height)))}
                  style={styles.copy}
                >
                  <View style={styles.headline}>
                    <Text variant="h1" accessibilityRole="header" style={styles.centerText}>{slide.title}</Text>
                  </View>
                  <Text variant="body" color="textMuted" style={[styles.centerText, { maxWidth: 320 }]}>{slide.description}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.pagination}>
            {SLIDES.map((slide, slideIndex) => (
              <Pressable
                key={slide.key}
                accessibilityRole="button"
                accessibilityLabel={`Show welcome slide ${slideIndex + 1}`}
                accessibilityState={{ selected: slideIndex === index }}
                onPress={() => selectSlide(slideIndex)}
                style={styles.dotTarget}
              >
                <View style={{ height: 7, width: slideIndex === index ? 22 : 7, borderRadius: 8, backgroundColor: slideIndex === index ? colors.primary : colors.border }} />
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <Button
              label={lastSlide ? 'Get Started' : 'Next'}
              accessibilityLabel={lastSlide ? 'Get Started' : 'Next welcome slide'}
              size="lg"
              fullWidth
              className="!rounded-full"
              rightIcon={<Text variant="button" color="textInverse">→</Text>}
              onPress={() => lastSlide ? router.push('/phone') : selectSlide(index + 1)}
            />
          </View>
          <View style={styles.login}>
            <Text variant="caption" color="textMuted">Already a member?</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/login')} style={styles.loginLink}>
              <Text variant="button" color="primary">Log in</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  outerContent: { flexGrow: 1, alignItems: 'center' },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skip: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  artwork: { alignItems: 'center', justifyContent: 'center' },
  copy: { minHeight: 164, paddingTop: 20, paddingBottom: 8, gap: 12, alignItems: 'center' },
  headline: { minHeight: 72, justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  pagination: { height: 56, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dotTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  login: { minHeight: 52, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  loginLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
