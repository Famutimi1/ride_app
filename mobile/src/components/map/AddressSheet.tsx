import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { autocompletePlaces, getPlaceDetails, getTripRoute, type PlacePrediction } from '@/services/mapsService';
import { useMapStore, type MapLocation } from '@/store/mapStore';
import { AddressSearchInput } from './AddressSearchInput';

export type AddressField = 'pickup' | 'dropoff';
type Field = AddressField;
interface SearchResult { key: string; predictions: PlacePrediction[]; loading: boolean; error: string | null }
interface MapSelection { field: AddressField; location: MapLocation; revision: number }
interface AddressSheetProps { onClose: () => void; onFindRide: () => void; onPickupChosen?: () => void; onActiveFieldChange?: (field: AddressField) => void; mapSelection?: MapSelection | null; mapSelectionPending?: boolean; onMapSelectionApplied?: (revision: number) => void; submitLabel?: string; title?: string; pickupLabel?: string; dropoffLabel?: string }

export function AddressSheet({ onClose, onFindRide, onPickupChosen, onActiveFieldChange, mapSelection, mapSelectionPending = false, onMapSelectionApplied, submitLabel = 'Find Now', title = 'Plan your ride', pickupLabel = 'From', dropoffLabel = 'To' }: AddressSheetProps) {
  const { height } = useWindowDimensions();
  const mediumHeight = height * 0.6;
  const expandedHeight = height * 0.88;
  const [sheetHeight] = useState(() => new Animated.Value(mediumHeight));
  const [dragStart] = useState(() => ({ value: mediumHeight }));
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
      <View {...panResponder.panHandlers} className="pb-sm pt-md">
        <View className="items-center pb-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
        <View className="flex-row items-center px-xl"><Pressable onPress={onClose}><Text variant="h3">←</Text></Pressable><Text variant="h3" className="ml-lg">{title}</Text></View>
      </View>
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="px-xl pb-md">
        <View className="relative gap-md">
          <AddressSearchInput active={activeField === 'pickup'} label={pickupLabel} placeholder="Pickup location" value={displayedPickup} loading={searching && activeField === 'pickup'} onFocus={() => { setActiveField('pickup'); onActiveFieldChange?.('pickup'); }} onChangeText={(value) => changeQuery('pickup', value)} />
          <AddressSearchInput
            active={activeField === 'dropoff'}
            label={dropoffLabel}
            placeholder="Where are you going?"
            value={dropoffText}
            loading={searching && activeField === 'dropoff'}
            rightAccessory={(
              <Pressable accessibilityLabel="Swap pickup and destination" onPress={swap} style={{ transform: [{ translateY: -6 }] }} className="h-8 w-8 items-center justify-center rounded-full bg-primary shadow-sm">
                <Text variant="bodyMedium" color="textInverse">⇅</Text>
              </Pressable>
            )}
            onFocus={() => { setActiveField('dropoff'); onActiveFieldChange?.('dropoff'); }}
            onChangeText={(value) => changeQuery('dropoff', value)}
          />
        </View>

        {(activeField === 'pickup' && current) || predictions.length || error ? <View className="mt-sm bg-surface">
          {activeField === 'pickup' && current ? <Pressable onPress={() => { selectionVersion.current += 1; void selectLocation('pickup', current); }} className="flex-row gap-md border-b border-border p-md"><Text color="primary">◎</Text><Text variant="bodyMedium">Use current location</Text></Pressable> : null}
          {predictions.map((item) => <Pressable key={item.placeId} onPress={() => void choosePrediction(item)} className="border-b border-border px-md py-sm"><Text variant="bodyMedium">{item.primaryText}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{item.secondaryText}</Text></Pressable>)}
          {error ? <Text variant="caption" color="textMuted" className="p-md">{error}</Text> : null}
        </View> : null}

        {error && pickup && dropoff ? <Pressable onPress={() => void selectLocation('dropoff', dropoff)} className="self-end py-sm"><Text variant="caption" color="primary">Retry route</Text></Pressable> : null}
      </ScrollView>
      <View className="border-t border-border px-xl pb-xl pt-md"><Button label={mapSelectionPending ? 'Choosing location…' : loadingRoute ? 'Mapping route…' : submitLabel} fullWidth loading={loadingRoute || mapSelectionPending} disabled={!pickup || !dropoff || pickupEdited || dropoffEdited || loadingPlace || loadingRoute || mapSelectionPending} onPress={onFindRide} /></View>
    </KeyboardAvoidingView>
  </Animated.View>;
}
