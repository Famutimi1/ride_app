import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import { androidMapStyle, mapStyles } from '@/constants/colors';
import { useTheme } from '@/constants/theme';
import { LAGOS_REGION, type MapCoordinate, type MapRegion } from '@/store/mapStore';
import type { AppMapHandle, AppMapMarker, AppMapProps } from './mapTypes';
import { MapMarker } from './MapMarker';
import { markerAnchor } from './markerStyle';
import { zoomForRegion } from './mapCamera';

export type { AppMapHandle, AppMapMarker, AppMapProps, MarkerKind } from './mapTypes';

const EMPTY_ROUTE: MapCoordinate[] = [];
const EMPTY_MARKERS: AppMapMarker[] = [];

function sameRegion(a: MapRegion, b: MapRegion): boolean {
  return Math.abs(a.latitude - b.latitude) < 0.000001 && Math.abs(a.longitude - b.longitude) < 0.000001
    && Math.abs(a.latitudeDelta - b.latitudeDelta) < 0.000001 && Math.abs(a.longitudeDelta - b.longitudeDelta) < 0.000001;
}

export const AppMap = forwardRef<AppMapHandle, AppMapProps>(function AppMap({
  region = LAGOS_REGION, markers = EMPTY_MARKERS, polyline = EMPTY_ROUTE, secondaryPolyline = EMPTY_ROUTE, fitRouteOnChange = false, followsUserLocation = false, onRegionChange,
  onRegionChangeComplete, onUserRegionChangeComplete, mapPadding = { top: 80, right: 24, bottom: 260, left: 24 }, showsUserLocation = false,
}, ref) {
  const { colors, scheme } = useTheme();
  const nativeRef = useRef<import('react-native-maps').default>(null);
  const [initialRegion] = useState(region);
  const requestedRegion = useRef(region);
  const reportedRegion = useRef(region);
  const [ready, setReady] = useState(false);
  const nativeReady = useRef(false);
  const pendingRegion = useRef<MapRegion | null>(null);
  const userMovedMap = useRef(false);
  const { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft } = mapPadding;
  const moveToRegion = useCallback((next: MapRegion) => {
    userMovedMap.current = false;
    if (!nativeReady.current) { pendingRegion.current = next; return; }
    if (Platform.OS === 'android') {
      nativeRef.current?.animateCamera({ center: next, zoom: zoomForRegion(next), heading: 0, pitch: 0 }, { duration: 500 });
    } else nativeRef.current?.animateToRegion(next, 500);
  }, []);
  const fitCoordinates = useCallback((points: MapCoordinate[]) => {
    if (!points.length) return;
    userMovedMap.current = false;
    // Android already applies mapPadding to its viewport. Passing it again as
    // edgePadding doubles the margins and makes the trip line unnecessarily small.
    nativeRef.current?.fitToCoordinates(points, {
      edgePadding: Platform.OS === 'android'
        ? { top: 0, right: 0, bottom: 0, left: 0 }
        : { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
      animated: true,
    });
  }, [paddingBottom, paddingLeft, paddingRight, paddingTop]);
  useImperativeHandle(ref, () => ({
    animateToRegion: moveToRegion,
    fitToCoordinates: fitCoordinates,
  }), [moveToRegion, fitCoordinates]);

  useEffect(() => {
    if (!ready) return;
    const unchanged = sameRegion(region, requestedRegion.current);
    requestedRegion.current = region;
    // Google reports bounds after applying viewport padding. Feeding those bounds
    // straight back into a controlled region repeatedly widens the Android camera.
    if (unchanged || sameRegion(region, reportedRegion.current)) return;
    if (fitRouteOnChange && (polyline.length > 1 || secondaryPolyline.length > 1)) return;
    moveToRegion(region);
  }, [ready, region, fitRouteOnChange, polyline, secondaryPolyline, moveToRegion]);

  useEffect(() => {
    const visibleRoute = polyline.length > 1 ? polyline : secondaryPolyline;
    if (ready && fitRouteOnChange && visibleRoute.length > 1) {
      fitCoordinates([...polyline, ...secondaryPolyline]);
    }
  }, [ready, fitRouteOnChange, fitCoordinates, polyline, secondaryPolyline]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const { default: MapView, Polyline, PROVIDER_GOOGLE } = maps;
  const isIosExpoGo = Platform.OS === 'ios' && Constants.appOwnership === AppOwnership.Expo;
  const mapStyle = Platform.OS === 'android' ? androidMapStyle : mapStyles[scheme];
  return <View style={styles.container} collapsable={false}>
    <MapView ref={nativeRef} provider={isIosExpoGo ? undefined : PROVIDER_GOOGLE}
      initialRegion={Platform.OS === 'android' ? undefined : initialRegion}
      initialCamera={Platform.OS === 'android' ? { center: initialRegion, zoom: zoomForRegion(initialRegion), heading: 0, pitch: 0 } : undefined}
      onMapReady={() => {
        nativeReady.current = true;
        const pending = pendingRegion.current;
        pendingRegion.current = null;
        if (pending) moveToRegion(pending);
        setReady(true);
      }}
      userInterfaceStyle={Platform.OS === 'android' ? 'light' : undefined}
      customMapStyle={mapStyle as unknown as import('react-native-maps').MapStyleElement[]} followsUserLocation={followsUserLocation} showsUserLocation={showsUserLocation}
      showsMyLocationButton={false} showsCompass={false} toolbarEnabled={false} mapPadding={mapPadding}
      loadingEnabled onRegionChange={onRegionChange} onPanDrag={() => { userMovedMap.current = true; }}
      onRegionChangeStart={(_, details) => { if (details.isGesture !== undefined) userMovedMap.current = details.isGesture; }}
      onRegionChangeComplete={(next, details) => {
        reportedRegion.current = next;
        onRegionChangeComplete?.(next);
        if (userMovedMap.current && details.isGesture !== false) onUserRegionChangeComplete?.(next);
        userMovedMap.current = false;
      }}
      style={styles.map}>
      {markers.map((marker) => marker.kind === 'driver'
        ? <SmoothDriverMarker key={marker.id} marker={marker} />
        : <NativeMarker key={marker.id} marker={marker} />)}
      {secondaryPolyline.length > 1 ? <Polyline coordinates={secondaryPolyline} strokeColor={colors.mapNearbyDriver} strokeWidth={3} lineDashPattern={[7, 7]} /> : null}
      {polyline.length > 1 ? <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} /> : null}
    </MapView>
  </View>;
});

function NativeMarker({ marker }: { marker: AppMapMarker }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Marker } = require('react-native-maps') as typeof import('react-native-maps');
  const markerRef = useRef<import('react-native-maps').MapMarker>(null);
  const redraw = useCallback(() => markerRef.current?.redraw(), []);
  return <Marker ref={markerRef} coordinate={marker} anchor={markerAnchor(marker.kind)} title={marker.title}
    rotation={marker.kind === 'nearby-driver' ? marker.heading ?? 0 : 0} tracksViewChanges={false}>
    <MapMarker kind={marker.kind} onRedraw={redraw} />
  </Marker>;
}

function SmoothDriverMarker({ marker }: { marker: AppMapMarker }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps') as typeof import('react-native-maps');
  const markerRef = useRef<import('react-native-maps').MapMarker>(null);
  const redraw = useCallback(() => markerRef.current?.redraw(), []);
  const [coordinate] = useState(() => new maps.AnimatedRegion({ latitude: marker.latitude, longitude: marker.longitude }));
  useEffect(() => {
    coordinate.timing({ latitude: marker.latitude, longitude: marker.longitude, latitudeDelta: 0, longitudeDelta: 0, toValue: 0, duration: 1_000, useNativeDriver: false }).start();
  }, [coordinate, marker.latitude, marker.longitude]);
  return <maps.Marker.Animated ref={markerRef} coordinate={coordinate as unknown as AppMapMarker} anchor={markerAnchor('driver')} rotation={marker.heading ?? 0} title={marker.title} tracksViewChanges={false}><MapMarker kind="driver" onRedraw={redraw} /></maps.Marker.Animated>;
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
