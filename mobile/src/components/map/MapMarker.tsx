import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { AccessibilityInfo, Animated, AppState, View } from 'react-native';
import { useTheme } from '@/constants/theme';
import { svgDataUri } from '@/utils/svgDataUri';
import type { MarkerKind } from './mapTypes';
import { markerSize } from './markerStyle';
import { markerSvg } from './markerSvg';

export function MapMarker({ kind, onRedraw }: { kind: MarkerKind; onRedraw?: () => void }) {
  const { colors } = useTheme();
  const source = useMemo(() => ({ uri: svgDataUri(markerSvg(kind, colors)) }), [colors, kind]);
  const size = markerSize(kind);
  const artwork = <Image source={source} contentFit="contain" onLoad={onRedraw} style={{ width: size, height: size }} />;
  if (kind === 'rider') return <RiderMarker onRedraw={onRedraw}>{artwork}</RiderMarker>;
  return <View collapsable={false} style={{ width: size, height: size }}>{artwork}</View>;
}

function RiderMarker({ children, onRedraw }: { children: React.ReactNode; onRedraw?: () => void }) {
  const [rise] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    let active = true;
    let preferenceChanged = false;
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      preferenceChanged = true;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active && !preferenceChanged) setReduceMotion(enabled);
    }).catch(() => { /* Retain a static marker if the preference is unavailable. */ });
    const application = AppState.addEventListener('change', setAppState);
    return () => { active = false; preference.remove(); application.remove(); };
  }, []);
  useFocusEffect(useCallback(() => {
    rise.setValue(0);
    if (reduceMotion || appState !== 'active') return;
    // Android markers are bitmap snapshots. Refresh while the JS-driven bounce runs;
    // animating only the child with the native driver leaves Google's bitmap static.
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(rise, { toValue: -7, duration: 650, useNativeDriver: false, isInteraction: false }),
      Animated.timing(rise, { toValue: 0, duration: 650, useNativeDriver: false, isInteraction: false }),
    ]));
    const redraw = setInterval(() => onRedraw?.(), 40);
    motion.start();
    return () => { motion.stop(); clearInterval(redraw); };
  }, [appState, onRedraw, reduceMotion, rise]));
  // Keep the full bounce inside the marker bitmap so the arrow never gets clipped.
  return <View collapsable={false} style={{ width: 44, height: 58, paddingTop: 14 }}>
    <Animated.View style={{ width: 44, height: 44, transform: [{ translateY: rise }] }}>{children}</Animated.View>
  </View>;
}
