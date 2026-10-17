import { useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Animated, View } from 'react-native';
import { useTheme } from '@/constants/theme';
import type { MarkerKind } from './mapTypes';
import { markerColor, markerSize } from './markerStyle';
import { locationPin, type LocationPinKind } from './locationPin';

const carSymbol = { ios: 'car.fill', android: 'directions_car', web: 'directions_car' } as const;

/** A3 pickup and B6 finish-flag pins use vector-style shapes that stay crisp on dense screens. */
function LocationPin({ kind }: { kind: LocationPinKind }) {
  const { colors } = useTheme();
  const color = markerColor(kind, colors);
  const { size, head, dot, pole, flag } = locationPin;
  return <View style={{ width: size, height: size, alignItems: 'center' }}>
    <View style={{
      position: 'absolute', left: head.left, top: head.top, width: head.size, height: head.size,
      transform: [{ rotate: `${head.rotation}deg` }],
      borderTopLeftRadius: head.radius, borderTopRightRadius: head.radius,
      borderBottomLeftRadius: head.radius, borderBottomRightRadius: head.tipRadius,
      backgroundColor: color, borderColor: colors.mapMarkerOutline, borderWidth: head.borderWidth,
      elevation: 5,
    }} />
    {kind === 'pickup'
      ? <View style={{ position: 'absolute', left: dot.left, top: dot.top, width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: colors.mapMarkerOutline }} />
      : <>
        <View style={{ position: 'absolute', left: pole.left, top: pole.top, width: pole.width, height: pole.height, backgroundColor: colors.mapMarkerOutline }} />
        {[0, 1, 2, 3].map((square) => <View key={square} style={{
          position: 'absolute', left: flag.left + (square % 2) * flag.squareWidth,
          top: flag.top + Math.floor(square / 2) * flag.squareHeight,
          width: flag.squareWidth, height: flag.squareHeight,
          backgroundColor: square === 0 || square === 3 ? color : colors.mapMarkerOutline,
        }} />)}
      </>}
  </View>;
}

function RiderMarker() {
  const { colors } = useTheme();
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(rise, { toValue: -7, duration: 650, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 650, useNativeDriver: true }),
    ]));
    motion.start();
    return () => motion.stop();
  }, [rise]);
  return <Animated.View style={{ width: 44, height: 44, alignItems: 'center', transform: [{ translateY: rise }] }}>
    <View style={{ position: 'absolute', top: 2, borderLeftWidth: 20, borderRightWidth: 20, borderTopWidth: 39, borderLeftColor: colors.mapMarkerTransparent, borderRightColor: colors.mapMarkerTransparent, borderTopColor: colors.mapMarkerOutline }} />
    <View style={{ position: 'absolute', top: 5, borderLeftWidth: 15, borderRightWidth: 15, borderTopWidth: 30, borderLeftColor: colors.mapMarkerTransparent, borderRightColor: colors.mapMarkerTransparent, borderTopColor: colors.mapRider }} />
  </Animated.View>;
}

export function MapMarker({ kind }: { kind: MarkerKind }) {
  const { colors } = useTheme();
  if (kind === 'pickup' || kind === 'dropoff') return <LocationPin kind={kind} />;
  if (kind === 'rider') return <RiderMarker />;
  const color = markerColor(kind, colors);
  const size = markerSize(kind);
  const subtle = kind === 'nearby-driver';
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{
      width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
      backgroundColor: subtle ? colors.surface : color,
      borderWidth: subtle ? 2 : 0, borderColor: color,
      elevation: 4,
    }}>
      <SymbolView name={carSymbol} size={kind === 'driver' ? 25 : 19}
        tintColor={subtle ? color : colors.textInverse} />
    </View>
  </View>;
}
