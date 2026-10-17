import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import { mapStyles } from '@/constants/colors';
import { useTheme } from '@/constants/theme';
import { LAGOS_REGION, type MapCoordinate } from '@/store/mapStore';
import type { AppMapHandle, AppMapMarker, AppMapProps } from './mapTypes';
import { MapMarker } from './MapMarker';
import { markerAnchor } from './markerStyle';

export type { AppMapHandle, AppMapMarker, AppMapProps, MarkerKind } from './mapTypes';

const EMPTY_ROUTE: MapCoordinate[] = [];
const EMPTY_MARKERS: AppMapMarker[] = [];

export const AppMap = forwardRef<AppMapHandle, AppMapProps>(function AppMap({
  region = LAGOS_REGION, markers = EMPTY_MARKERS, polyline = EMPTY_ROUTE, secondaryPolyline = EMPTY_ROUTE, followsUserLocation = false, onRegionChange,
  onRegionChangeComplete, onUserRegionChangeComplete, mapPadding = { top: 80, right: 24, bottom: 260, left: 24 }, showsUserLocation = false,
}, ref) {
  const { colors, scheme } = useTheme();
  const nativeRef = useRef<import('react-native-maps').default>(null);
  const userMovedMap = useRef(false);
  const { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft } = mapPadding;
  useImperativeHandle(ref, () => ({
    animateToRegion: (next) => nativeRef.current?.animateToRegion(next, 500),
    fitToCoordinates: (points) => nativeRef.current?.fitToCoordinates(points, { edgePadding: mapPadding, animated: true }),
  }), [mapPadding]);

  useEffect(() => {
    const visibleRoute = polyline.length > 1 ? polyline : secondaryPolyline;
    if (Platform.OS !== 'web' && visibleRoute.length > 1) {
      nativeRef.current?.fitToCoordinates(visibleRoute, {
        edgePadding: { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
        animated: true,
      });
    }
  }, [paddingBottom, paddingLeft, paddingRight, paddingTop, polyline, secondaryPolyline]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const { default: MapView, Marker, Polyline, PROVIDER_GOOGLE } = maps;
  const isIosExpoGo = Platform.OS === 'ios' && Constants.appOwnership === AppOwnership.Expo;
  return <View style={styles.container} collapsable={false}>
    <MapView ref={nativeRef} provider={isIosExpoGo ? undefined : PROVIDER_GOOGLE} region={region}
      customMapStyle={mapStyles[scheme] as unknown as import('react-native-maps').MapStyleElement[]} followsUserLocation={followsUserLocation} showsUserLocation={showsUserLocation}
      showsMyLocationButton={false} showsCompass={false} toolbarEnabled={false} mapPadding={mapPadding}
      loadingEnabled onRegionChange={onRegionChange} onPanDrag={() => { userMovedMap.current = true; }}
      onRegionChangeComplete={(next) => {
        onRegionChangeComplete?.(next);
        if (userMovedMap.current) onUserRegionChangeComplete?.(next);
        userMovedMap.current = false;
      }}
      style={styles.map}>
      {markers.map((marker) => marker.kind === 'driver'
        ? <SmoothDriverMarker key={marker.id} marker={marker} />
        : <Marker key={marker.id} coordinate={marker} anchor={markerAnchor(marker.kind)} title={marker.title} tracksViewChanges={marker.kind === 'rider'}><MapMarker kind={marker.kind} /></Marker>)}
      {secondaryPolyline.length > 1 ? <Polyline coordinates={secondaryPolyline} strokeColor={colors.mapNearbyDriver} strokeWidth={3} lineDashPattern={[7, 7]} /> : null}
      {polyline.length > 1 ? <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} /> : null}
    </MapView>
  </View>;
});

function SmoothDriverMarker({ marker }: { marker: AppMapMarker }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const [coordinate] = useState(() => new maps.AnimatedRegion({ latitude: marker.latitude, longitude: marker.longitude }));
  useEffect(() => {
    coordinate.timing({ latitude: marker.latitude, longitude: marker.longitude, latitudeDelta: 0, longitudeDelta: 0, toValue: 0, duration: 1_000, useNativeDriver: false }).start();
  }, [coordinate, marker.latitude, marker.longitude]);
  return <maps.Marker.Animated coordinate={coordinate as unknown as AppMapMarker} anchor={markerAnchor('driver')} rotation={marker.heading ?? 0} title={marker.title}><MapMarker kind="driver" /></maps.Marker.Animated>;
}

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
