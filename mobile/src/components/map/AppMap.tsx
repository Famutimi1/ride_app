import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common';
import { mapStyles } from '@/constants/colors';
import { useTheme } from '@/constants/theme';
import { LAGOS_REGION, type MapCoordinate, type MapRegion } from '@/store/mapStore';

export type MarkerKind = 'pickup' | 'dropoff' | 'driver' | 'rider' | 'nearby-driver';
export interface AppMapMarker extends MapCoordinate { id: string; kind: MarkerKind; heading?: number; title?: string }
export interface AppMapHandle { animateToRegion: (region: MapRegion) => void; fitToCoordinates: (coordinates: MapCoordinate[]) => void }
interface AppMapProps {
  region?: MapRegion; markers?: AppMapMarker[]; polyline?: MapCoordinate[]; followsUserLocation?: boolean;
  onRegionChange?: (region: MapRegion) => void; onRegionChangeComplete?: (region: MapRegion) => void;
  mapPadding?: { top: number; right: number; bottom: number; left: number }; showsUserLocation?: boolean;
}

export const AppMap = forwardRef<AppMapHandle, AppMapProps>(function AppMap({
  region = LAGOS_REGION, markers = [], polyline = [], followsUserLocation = false, onRegionChange,
  onRegionChangeComplete, mapPadding = { top: 80, right: 24, bottom: 260, left: 24 }, showsUserLocation = false,
}, ref) {
  const { colors, scheme } = useTheme();
  const nativeRef = useRef<import('react-native-maps').default>(null);
  const { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft } = mapPadding;
  useImperativeHandle(ref, () => ({
    animateToRegion: (next) => nativeRef.current?.animateToRegion(next, 500),
    fitToCoordinates: (points) => nativeRef.current?.fitToCoordinates(points, { edgePadding: mapPadding, animated: true }),
  }), [mapPadding]);

  useEffect(() => {
    if (Platform.OS !== 'web' && polyline.length > 1) {
      nativeRef.current?.fitToCoordinates(polyline, {
        edgePadding: { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
        animated: true,
      });
    }
  }, [paddingBottom, paddingLeft, paddingRight, paddingTop, polyline]);

  if (Platform.OS === 'web') {
    const center = markers[0] ?? region;
    return <View className="flex-1 overflow-hidden bg-surfaceMuted">{createElement('iframe', {
      allowFullScreen: true, 'aria-label': 'Google map of Lagos', src: `https://www.google.com/maps?q=${center.latitude},${center.longitude}&z=15&output=embed`,
      style: { border: 0, height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' }, title: 'Google map of Lagos',
    })}</View>;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const { default: MapView, Marker, Polyline, PROVIDER_GOOGLE } = maps;
  const isIosExpoGo = Platform.OS === 'ios' && Constants.appOwnership === AppOwnership.Expo;
  return <View style={styles.container} collapsable={false}>
    <MapView ref={nativeRef} provider={isIosExpoGo ? undefined : PROVIDER_GOOGLE} region={region}
      customMapStyle={mapStyles[scheme] as unknown as import('react-native-maps').MapStyleElement[]} followsUserLocation={followsUserLocation} showsUserLocation={showsUserLocation}
      showsMyLocationButton={false} showsCompass={false} toolbarEnabled={false} mapPadding={mapPadding}
      loadingEnabled onRegionChange={onRegionChange} onRegionChangeComplete={onRegionChangeComplete}
      style={styles.map}>
      {markers.map((marker) => <Marker key={marker.id} coordinate={marker} anchor={{ x: 0.5, y: 0.5 }} rotation={marker.heading ?? 0} title={marker.title}>
        <MapMarker kind={marker.kind} />
      </Marker>)}
      {polyline.length > 1 ? <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} /> : null}
    </MapView>
  </View>;
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 1,
    minWidth: 1,
    overflow: 'hidden',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
});

function MapMarker({ kind }: { kind: MarkerKind }) {
  const { colors } = useTheme();
  const config = {
    pickup: { color: colors.mapPickup, glyph: '●', size: 34 }, dropoff: { color: colors.mapDropoff, glyph: '■', size: 34 },
    driver: { color: colors.mapDriver, glyph: '▲', size: 42 }, rider: { color: colors.mapPickup, glyph: '●', size: 22 },
    'nearby-driver': { color: colors.mapNearbyDriver, glyph: '▲', size: 34 },
  }[kind];
  return <View style={{ width: config.size, height: config.size, backgroundColor: colors.surface, borderColor: config.color }} className="items-center justify-center rounded-full border-2 shadow-md">
    <Text variant="bodyMedium" style={{ color: config.color }}>{config.glyph}</Text>
  </View>;
}
