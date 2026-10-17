import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { LAGOS_REGION, type MapCoordinate, type MapRegion } from '@/store/mapStore';
import type { AppMapHandle, AppMapMarker, AppMapProps } from './mapTypes';
import { markerAnchor, markerColor, markerSize } from './markerStyle';
import { locationPin, locationPinSvg } from './locationPin';

export type { AppMapHandle, AppMapMarker, AppMapProps, MarkerKind } from './mapTypes';

const EMPTY_ROUTE: MapCoordinate[] = [];
const EMPTY_MARKERS: AppMapMarker[] = [];

type LatLng = { lat: number; lng: number };
type MapInstance = {
  setCenter: (point: LatLng) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: BoundsInstance, padding?: number | { top: number; right: number; bottom: number; left: number }) => void;
  addListener: (name: string, callback: () => void) => { remove: () => void };
  getCenter: () => { lat: () => number; lng: () => number } | undefined;
  getZoom: () => number | undefined;
  getBounds: () => { toSpan: () => { lat: () => number; lng: () => number } } | undefined;
};
type BoundsInstance = { extend: (point: LatLng) => void };
type MarkerInstance = { setMap: (map: MapInstance | null) => void; setPosition: (position: LatLng) => void; setIcon: (icon: Record<string, unknown>) => void };
type PolylineInstance = { setMap: (map: MapInstance | null) => void };
type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  Marker: new (options: Record<string, unknown>) => MarkerInstance;
  Polyline: new (options: Record<string, unknown>) => PolylineInstance;
  LatLngBounds: new () => BoundsInstance;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Animation: { BOUNCE: unknown };
};
type MapWindow = Window & { google?: { maps: GoogleMaps }; __rakkyMapReady?: () => void };

const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
let mapsPromise: Promise<GoogleMaps> | null = null;

function loadGoogleMaps(): Promise<GoogleMaps> {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const mapWindow = window as MapWindow;
    if (mapWindow.google?.maps?.Map) { resolve(mapWindow.google.maps); return; }
    if (!mapsKey) { reject(new Error('Google Maps web key is missing')); return; }
    const script = document.createElement('script');
    const query = new URLSearchParams({ key: mapsKey, callback: '__rakkyMapReady', loading: 'async' });
    script.src = `https://maps.googleapis.com/maps/api/js?${query.toString()}`;
    script.async = true;
    mapWindow.__rakkyMapReady = () => { delete mapWindow.__rakkyMapReady; resolve(mapWindow.google!.maps); };
    script.onerror = () => { delete mapWindow.__rakkyMapReady; mapsPromise = null; reject(new Error('Google Maps could not load')); };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

const point = ({ latitude, longitude }: MapCoordinate): LatLng => ({ lat: latitude, lng: longitude });
const zoomFor = (region: MapRegion) => Math.max(4, Math.min(19, Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 0.001)))));

function markerIcon(marker: AppMapMarker, colors: ReturnType<typeof useTheme>['colors'], maps: GoogleMaps) {
  const { kind } = marker;
  const anchor = markerAnchor(kind);
  if (kind === 'pickup' || kind === 'dropoff') {
    const size = locationPin.size;
    return {
      url: `data:image/svg+xml,${encodeURIComponent(locationPinSvg(kind, colors))}`,
      scaledSize: new maps.Size(size, size),
      anchor: new maps.Point(size * anchor.x, size * anchor.y),
    };
  }
  const color = markerColor(kind, colors);
  const surface = colors.surface;
  const inverse = colors.textInverse;
  const size = markerSize(kind);
  const heading = Number.isFinite(marker.heading) ? marker.heading! : 0;
  const glyph = kind === 'rider'
        ? `<path d="M5 5 24 43 43 5 24 14Z" fill="${color}" stroke="${colors.mapMarkerOutline}" stroke-width="3" stroke-linejoin="round"/>`
        : `<g transform="rotate(${heading} 24 24)"><rect x="12" y="3" width="24" height="42" rx="9" fill="${kind === 'driver' ? color : surface}" stroke="${color}" stroke-width="3"/><path d="M17 12h14l2 10H15zM17 31h14l-2 8H19z" fill="${kind === 'driver' ? inverse : color}"/><path d="M10 15h3m22 0h3M10 34h3m22 0h3" stroke="${color}" stroke-width="3" stroke-linecap="round"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${glyph}</svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, scaledSize: new maps.Size(size, size), anchor: new maps.Point(size * anchor.x, size * anchor.y) };
}

export const AppMap = forwardRef<AppMapHandle, AppMapProps>(function AppMap({
  region = LAGOS_REGION, markers = EMPTY_MARKERS, polyline = EMPTY_ROUTE, secondaryPolyline = EMPTY_ROUTE, fitRouteOnChange = false,
  mapPadding = { top: 80, right: 24, bottom: 260, left: 24 }, onRegionChangeComplete, onUserRegionChangeComplete,
}, ref) {
  const { colors } = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const initialRegion = useRef(region);
  const map = useRef<MapInstance | null>(null);
  const google = useRef<GoogleMaps | null>(null);
  const drawnMarkers = useRef<Map<string, MarkerInstance>>(new Map());
  const drawnRoute = useRef<PolylineInstance | null>(null);
  const drawnSecondaryRoute = useRef<PolylineInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onRegionChangeComplete, onUserRegionChangeComplete });
  callbacks.current = { onRegionChangeComplete, onUserRegionChangeComplete };

  useImperativeHandle(ref, () => ({
    animateToRegion: (next) => { map.current?.setCenter(point(next)); map.current?.setZoom(zoomFor(next)); },
    fitToCoordinates: (coordinates) => {
      if (!map.current || !google.current || !coordinates.length) return;
      const bounds = new google.current.LatLngBounds();
      coordinates.forEach((coordinate) => bounds.extend(point(coordinate)));
      map.current.fitBounds(bounds, 60);
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    const markerInstances = drawnMarkers.current;
    let idleListener: { remove: () => void } | undefined;
    let dragListener: { remove: () => void } | undefined;
    let userMovedMap = false;
    void loadGoogleMaps().then((maps) => {
      if (disposed || !container.current) return;
      google.current = maps;
      map.current = new maps.Map(container.current, { center: point(initialRegion.current), zoom: zoomFor(initialRegion.current), disableDefaultUI: true, clickableIcons: false });
      dragListener = map.current.addListener('dragstart', () => { userMovedMap = true; });
      idleListener = map.current.addListener('idle', () => {
        const center = map.current?.getCenter();
        const span = map.current?.getBounds()?.toSpan();
        if (!center || !span) return;
        const next = { latitude: center.lat(), longitude: center.lng(), latitudeDelta: span.lat(), longitudeDelta: span.lng() };
        callbacks.current.onRegionChangeComplete?.(next);
        if (userMovedMap) callbacks.current.onUserRegionChangeComplete?.(next);
        userMovedMap = false;
      });
      setReady(true);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; idleListener?.remove(); dragListener?.remove(); markerInstances.forEach((item) => item.setMap(null)); markerInstances.clear(); drawnRoute.current?.setMap(null); drawnSecondaryRoute.current?.setMap(null); map.current = null; };
  // A map instance is created once; region and markers are updated below.
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (fitRouteOnChange && (polyline.length > 1 || secondaryPolyline.length > 1)) return;
    const center = map.current.getCenter();
    if (!center || Math.abs(center.lat() - region.latitude) > 0.000001 || Math.abs(center.lng() - region.longitude) > 0.000001) {
      map.current.setCenter(point(region));
    }
    // Interactive maps report their own viewport bounds. Deriving zoom back from those
    // bounds changes it by a step on narrow screens and creates an idle/update loop.
    if (!onRegionChangeComplete && map.current.getZoom() !== zoomFor(region)) map.current.setZoom(zoomFor(region));
  }, [ready, region, onRegionChangeComplete, fitRouteOnChange, polyline, secondaryPolyline]);
  useEffect(() => {
    if (!ready || !map.current || !google.current) return;
    const maps = google.current;
    const visible = new Set(markers.map((marker) => marker.id));
    drawnMarkers.current.forEach((instance, id) => { if (!visible.has(id)) { instance.setMap(null); drawnMarkers.current.delete(id); } });
    markers.forEach((marker) => {
      const existing = drawnMarkers.current.get(marker.id);
      if (existing) { existing.setPosition(point(marker)); existing.setIcon(markerIcon(marker, colors, maps)); return; }
      drawnMarkers.current.set(marker.id, new maps.Marker({
        map: map.current, position: point(marker), title: marker.title ?? (marker.kind.includes('driver') ? 'Available driver' : marker.kind),
        icon: markerIcon(marker, colors, maps),
        animation: marker.kind === 'rider' ? maps.Animation.BOUNCE : null,
      }));
    });
  }, [ready, markers, colors]);
  useEffect(() => {
    drawnRoute.current?.setMap(null);
    drawnSecondaryRoute.current?.setMap(null);
    drawnRoute.current = null;
    drawnSecondaryRoute.current = null;
    if (!ready || !map.current || !google.current) return;
    const maps = google.current;
    if (secondaryPolyline.length > 1) drawnSecondaryRoute.current = new maps.Polyline({ map: map.current, path: secondaryPolyline.map(point), strokeColor: colors.mapNearbyDriver, strokeOpacity: 0.7, strokeWeight: 3 });
    if (polyline.length > 1) drawnRoute.current = new maps.Polyline({ map: map.current, path: polyline.map(point), strokeColor: colors.primary, strokeWeight: 5 });
    if (fitRouteOnChange && (polyline.length > 1 || secondaryPolyline.length > 1)) {
      const bounds = new maps.LatLngBounds();
      [...polyline, ...secondaryPolyline].forEach((coordinate) => bounds.extend(point(coordinate)));
      map.current.fitBounds(bounds, { top: mapPadding.top, right: mapPadding.right, bottom: mapPadding.bottom, left: mapPadding.left });
    }
  }, [ready, polyline, secondaryPolyline, colors, fitRouteOnChange, mapPadding.top, mapPadding.right, mapPadding.bottom, mapPadding.left]);

  return <View className="flex-1 overflow-hidden bg-surfaceMuted">
    {createElement('div', { ref: container, 'aria-label': 'Google map with nearby drivers', style: { position: 'absolute', inset: 0 } })}
    {failed ? <View className="absolute left-4 right-4 top-4 rounded-lg bg-surface p-sm"><Text variant="caption">Map unavailable. Check the Google Maps web key and Maps JavaScript API.</Text></View> : null}
  </View>;
});
