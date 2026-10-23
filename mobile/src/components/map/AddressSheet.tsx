import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { borderWidths, useTheme } from '@/constants/theme';
import { autocompletePlaces, getPlaceDetails, getTripRoute, type PlacePrediction } from '@/services/mapsService';
import { useMapStore, type MapLocation } from '@/store/mapStore';
import { AddressSearchInput } from './AddressSearchInput';
import { AddressIcon } from './AddressIcon';

export type AddressField = 'pickup' | 'dropoff';
type Field = AddressField;
interface SearchResult { key: string; predictions: PlacePrediction[]; loading: boolean; error: string | null }
interface MapSelection { field: AddressField; location: MapLocation; revision: number }
interface AddressSheetProps { onFindRide: () => void; onPickupChosen?: () => void; onActiveFieldChange?: (field: AddressField) => void; mapSelection?: MapSelection | null; mapSelectionPending?: boolean; onMapSelectionApplied?: (revision: number) => void; submitLabel?: string; title?: string; pickupLabel?: string; dropoffLabel?: string }

export function AddressSheet({ onFindRide, onPickupChosen, onActiveFieldChange, mapSelection, mapSelectionPending = false, onMapSelectionApplied, submitLabel = 'Find Now', title = 'Plan your ride', pickupLabel = 'From', dropoffLabel = 'To' }: AddressSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const mediumHeight = height * 0.6;
  const expandedHeight = height * 0.88;
  const [sheetHeight] = useState(() => new Animated.Value(mediumHeight));
  const [dragStart] = useState(() => ({ value: mediumHeight }));
  useEffect(() => { sheetHeight.setValue(mediumHeight); }, [mediumHeight, sheetHeight]);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const current = useMapStore((state) => state.currentLocation);
  const setPickup = useMapStore((state) => state.setPickupLocation);
  const setDropoff = useMapStore((state) => state.setDropoffLocation);
  const setRoute = useMapStore((state) => state.setRouteCoordinates);
  const setRouteForEndpoints = useMapStore((state) => state.setRouteForEndpoints);
  const [activeField, setActiveField] = useState<Field>('dropoff');
  const [pickupEdited, setPickupEdited] = useState(false);
  const [dropoffEdited, setDropoffEdited] = useState(false);
  const selectionVersion = useRef(0);
  const routeVersion = useRef(0);
  const handledMapSelection = useRef(0);
  const [pickupText, setPickupText] = useState(pickup?.address ?? current?.address ?? '');
  const [dropoffText, setDropoffText] = useState(dropoff?.address ?? '');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const displayedPickup = pickupEdited ? pickupText : (pickup?.address ?? pickupText);
  const query = activeField === 'pickup' ? pickupEdited ? pickupText : '' : dropoffEdited ? dropoffText : '';

  useEffect(() => () => { selectionVersion.current += 1; routeVersion.current += 1; }, []);

  const normalizedQuery = query.trim();
  const searchKey = `${activeField}:${normalizedQuery}`;
  // Results belong to one field/query. Clearing or changing it hides stale data
  // immediately, without resetting state from an effect.
  const matchingSearch = normalizedQuery.length >= 2 && searchResult?.key === searchKey
    ? searchResult : null;
  const predictions = matchingSearch?.predictions ?? [];
  const searching = loadingPlace || (matchingSearch?.loading ?? false);
  const error = actionError ?? matchingSearch?.error ?? null;

  useEffect(() => {
    if (normalizedQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchResult({ key: searchKey, predictions: [], loading: true, error: null });
      try {
        const results = await autocompletePlaces(normalizedQuery, current ?? undefined);
        if (cancelled) return;
        setSearchResult({
          key: searchKey, predictions: results, loading: false,
          error: results.length ? null : 'No results. Try another search or adjust the map pin.',
        });
      } catch {
        if (!cancelled) setSearchResult({
          key: searchKey, predictions: [], loading: false,
          error: 'Address search is unavailable. You can still adjust the map pin.',
        });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [current, normalizedQuery, searchKey]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => sheetHeight.stopAnimation((value) => { dragStart.value = value; }),
    onPanResponderMove: (_, gesture) => sheetHeight.setValue(Math.max(mediumHeight, Math.min(expandedHeight, dragStart.value - gesture.dy))),
    onPanResponderRelease: (_, gesture) => {
      const expand = gesture.vy < -0.25 || dragStart.value - gesture.dy > (mediumHeight + expandedHeight) / 2;
      Animated.spring(sheetHeight, { toValue: expand ? expandedHeight : mediumHeight, useNativeDriver: false, damping: 24, stiffness: 220 }).start();
    },
  }), [dragStart, expandedHeight, mediumHeight, sheetHeight]);

  const selectLocation = useCallback(async (kind: Field, location: MapLocation) => {
    if (location.countryCode && !['NG', 'Nigeria'].includes(location.countryCode)) {
      setError('Rakky Ride is not available in this area yet. Choose a location in Nigeria.'); return;
    }
    const version = ++routeVersion.current;
    setRoute([]);
    if (kind === 'pickup') { onPickupChosen?.(); setPickup(location); setPickupText(location.address); setPickupEdited(false); }
    else { setDropoff(location); setDropoffText(location.address); setDropoffEdited(false); }
    setSearchResult(null);
    const other = kind === 'pickup' ? dropoff : pickup;
    if (!other) return;
    const start = kind === 'pickup' ? location : other;
    const end = kind === 'dropoff' ? location : other;
    setLoadingRoute(true); setError(null);
    try {
      const route = await getTripRoute(start, end);
      if (version === routeVersion.current) setRouteForEndpoints(start, end, route.coordinates);
    } catch { if (version === routeVersion.current) setError('Route could not be loaded. Check your connection and retry.'); }
    finally { if (version === routeVersion.current) setLoadingRoute(false); }
  }, [dropoff, onPickupChosen, pickup, setDropoff, setPickup, setRoute, setRouteForEndpoints]);

  useEffect(() => {
    if (!mapSelection || handledMapSelection.current === mapSelection.revision) return;
    handledMapSelection.current = mapSelection.revision;
    selectionVersion.current += 1;
    void selectLocation(mapSelection.field, mapSelection.location).finally(() => onMapSelectionApplied?.(mapSelection.revision));
  }, [mapSelection, onMapSelectionApplied, selectLocation]);

  const choosePrediction = async (prediction: PlacePrediction) => {
    const kind = activeField;
    const version = ++selectionVersion.current;
    setLoadingPlace(true);
    try {
      const location = await getPlaceDetails(prediction.placeId);
      if (version === selectionVersion.current) await selectLocation(kind, location);
    } catch { if (version === selectionVersion.current) setError('Could not load that place. Please try again.'); }
    finally { if (version === selectionVersion.current) setLoadingPlace(false); }
  };

  const changeQuery = (field: Field, value: string) => {
    selectionVersion.current += 1;
    routeVersion.current += 1;
    setLoadingPlace(false); setLoadingRoute(false); setRoute([]);
    setActiveField(field); setSearchResult(null); setError(null);
    onActiveFieldChange?.(field);
    if (field === 'pickup') { onPickupChosen?.(); setPickup(null); setPickupEdited(true); setPickupText(value); }
    else { setDropoff(null); setDropoffEdited(true); setDropoffText(value); }
  };

  const swap = () => {
    selectionVersion.current += 1;
    const version = ++routeVersion.current;
    onPickupChosen?.();
    setPickup(dropoff); setDropoff(pickup); setPickupText(dropoffText); setDropoffText(pickupText);
    setPickupEdited(!dropoff); setDropoffEdited(!pickup); setRoute([]); setSearchResult(null);
    if (pickup && dropoff) {
      setLoadingRoute(true); setError(null);
      void getTripRoute(dropoff, pickup)
        .then((route) => { if (version === routeVersion.current) setRouteForEndpoints(dropoff, pickup, route.coordinates); })
        .catch(() => { if (version === routeVersion.current) setError('Route could not be loaded. Check your connection and retry.'); })
        .finally(() => { if (version === routeVersion.current) setLoadingRoute(false); });
    }
  };

  return <Animated.View className="absolute bottom-0 left-0 right-0 rounded-t-[28px] bg-surface shadow-lg" style={{ height: sheetHeight }}>
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View {...panResponder.panHandlers} style={styles.header}>
        <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
        <Text variant="bodyMedium">{title}</Text>
      </View>
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.fields}>
          <AddressSearchInput kind="pickup" active={activeField === 'pickup'} label={pickupLabel} placeholder="Pickup location" value={displayedPickup} loading={searching && activeField === 'pickup'} onFocus={() => { setActiveField('pickup'); onActiveFieldChange?.('pickup'); }} onChangeText={(value) => changeQuery('pickup', value)} />
          <AddressSearchInput kind="dropoff" active={activeField === 'dropoff'} label={dropoffLabel} placeholder="Where are you going?" value={dropoffText} loading={searching && activeField === 'dropoff'} onFocus={() => { setActiveField('dropoff'); onActiveFieldChange?.('dropoff'); }} onChangeText={(value) => changeQuery('dropoff', value)} />
          <Pressable accessibilityRole="button" accessibilityLabel="Swap pickup and destination" onPress={swap} style={[styles.swap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <AddressIcon name="swap" color="primary" />
          </Pressable>
        </View>

        {activeField === 'pickup' && current ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Use current location for pickup" onPress={() => { selectionVersion.current += 1; void selectLocation('pickup', current); }} style={[styles.currentLocation, { borderBottomColor: colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: colors.primarySoft }]}><AddressIcon name="locate" color="primary" size={17} /></View>
            <Text variant="button" color="primary" style={styles.resultCopy}>Use current location</Text>
          </Pressable>
        ) : null}
        {predictions.length ? <Text variant="caption" color="textMuted" style={styles.resultsLabel}>Suggestions</Text> : null}
        {predictions.map(item => (
          <Pressable key={item.placeId} accessibilityRole="button" accessibilityLabel={`${item.primaryText}, ${item.secondaryText}`} onPress={() => void choosePrediction(item)} style={[styles.resultRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: colors.primarySoft }]}><AddressIcon name="pin" size={16} /></View>
            <View style={styles.resultCopy}>
              <Text variant="button" numberOfLines={2}>{item.primaryText}</Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>{item.secondaryText}</Text>
            </View>
          </Pressable>
        ))}
        {searching ? <Text accessibilityLiveRegion="polite" variant="caption" color="textMuted" style={styles.status}>Searching addresses…</Text> : null}
        {error ? <Text accessibilityRole="alert" variant="caption" color="textMuted" style={styles.status}>{error}</Text> : null}
        {error && pickup && dropoff ? <Pressable accessibilityRole="button" onPress={() => void selectLocation('dropoff', dropoff)} style={styles.retry}><Text variant="caption" color="primary">Retry route</Text></Pressable> : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: Math.max(16, insets.bottom) }]}>
        <Button label={mapSelectionPending ? 'Choosing location…' : loadingRoute ? 'Mapping route…' : submitLabel} fullWidth loading={loadingRoute || mapSelectionPending} disabled={!pickup || !dropoff || pickupEdited || dropoffEdited || loadingPlace || loadingRoute || mapSelectionPending} onPress={onFindRide} className="rounded-xl" />
      </View>
    </KeyboardAvoidingView>
  </Animated.View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, gap: 18 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  fields: { gap: 12 },
  swap: { position: 'absolute', right: 0, top: 46, width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  currentLocation: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 10, borderBottomWidth: borderWidths.divider },
  resultIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultsLabel: { marginTop: 16, marginBottom: 4 },
  resultRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: borderWidths.divider },
  status: { paddingVertical: 12 },
  retry: { alignSelf: 'flex-end', minHeight: 48, justifyContent: 'center' },
  footer: { borderTopWidth: borderWidths.divider, paddingHorizontal: 16, paddingTop: 12 },
});
