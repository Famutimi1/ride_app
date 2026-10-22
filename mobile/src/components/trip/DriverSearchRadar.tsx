import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { RideIcon } from '@/components/common/RideIcon';
import { useTheme } from '@/constants/theme';

const DIAMETER = 108;

/** Decorative search activity, never a map of drivers or a measure of progress. */
export function DriverSearchRadar({ courier = false, compact = false }: { courier?: boolean; compact?: boolean }) {
  const { colors } = useTheme();
  const [rotation] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    let active = true;
    let preferenceChanged = false;
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      preferenceChanged = true;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active && !preferenceChanged) setReduceMotion(enabled);
    }).catch(() => { /* Keep a static radar if the accessibility preference is unavailable. */ });
    const appSubscription = AppState.addEventListener('change', setAppState);
    return () => {
      active = false;
      motionSubscription?.remove();
      appSubscription?.remove();
    };
  }, []);

  useEffect(() => {
    rotation.setValue(0);
    if (reduceMotion || appState !== 'active') return;
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1,
      duration: 3800,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
      isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [appState, reduceMotion, rotation]);

  const sweep = useMemo(() => {
    // Small translucent sectors form a soft sweep on native and web without a new dependency.
    const sectors = Array.from({ length: 24 }, (_, index) => {
      const start = (index * 5 - 120) * Math.PI / 180;
      const end = ((index + 1) * 5 - 120) * Math.PI / 180;
      const x1 = 54 + 54 * Math.cos(start), y1 = 54 + 54 * Math.sin(start);
      const x2 = 54 + 54 * Math.cos(end), y2 = 54 + 54 * Math.sin(end);
      return `<path d="M54 54L${x1.toFixed(3)} ${y1.toFixed(3)}A54 54 0 0 1 ${x2.toFixed(3)} ${y2.toFixed(3)}Z" fill="${colors.primary}" fill-opacity="${((index + 1) / 24 * 0.26).toFixed(3)}"/>`;
    }).join('');
    return { uri: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">${sectors}</svg>`)}` };
  }, [colors.primary]);

  const diameter = compact ? 84 : DIAMETER;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.radar, { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: colors.primarySoft }]}>
    <Animated.View testID="driver-search-sweep" style={[StyleSheet.absoluteFill, { transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
      <Image source={sweep} contentFit="contain" style={{ width: diameter, height: diameter }} />
    </Animated.View>
    {[0, 14, 29].map(inset => <View key={inset} style={[styles.ring, { inset: inset * diameter / DIAMETER, borderColor: colors.primary }]} />)}
    <View style={[styles.car, { width: compact ? 34 : 42, height: compact ? 34 : 42, backgroundColor: colors.primary }]}><RideIcon name={courier ? 'package' : 'car'} size={compact ? 22 : 28} color="textInverse" /></View>
  </View>;
}

const styles = StyleSheet.create({
  radar: { width: DIAMETER, height: DIAMETER, borderRadius: DIAMETER / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1, borderRadius: DIAMETER / 2, opacity: 0.16 },
  car: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
