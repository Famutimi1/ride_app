import { useEffect, useMemo, useState } from 'react';
import { Animated, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { autocompletePlaces, getPlaceDetails, getTripEstimate, getTripRoute, type PlacePrediction } from '@/services/mapsService';
import { useMapStore, type MapLocation } from '@/store/mapStore';
import { AddressSearchInput } from './AddressSearchInput';

type Field = 'pickup' | 'dropoff';
interface AddressSheetProps { onClose: () => void; onFindRide: () => void }

export function AddressSheet({ onClose, onFindRide }: AddressSheetProps) {
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
  const [activeField, setActiveField] = useState<Field>('dropoff');
  const [pickupEdited, setPickupEdited] = useState(false);
  const [pickupText, setPickupText] = useState(pickup?.address ?? current?.address ?? '');
  const [dropoffText, setDropoffText] = useState(dropoff?.address ?? '');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayedPickup = pickupEdited ? pickupText : (pickup?.address ?? pickupText);
  const query = activeField === 'pickup' ? displayedPickup : dropoffText;

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      setSearching(true); setError(null);
      try {
        const results = await autocompletePlaces(query.trim(), current ?? undefined);
        setPredictions(results);
        if (!results.length) setError('No results. Try another search or adjust the map pin.');
      } catch { setPredictions([]); setError('Address search is unavailable. You can still adjust the map pin.'); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [current, query]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => sheetHeight.stopAnimation((value) => { dragStart.value = value; }),
    onPanResponderMove: (_, gesture) => sheetHeight.setValue(Math.max(mediumHeight, Math.min(expandedHeight, dragStart.value - gesture.dy))),
    onPanResponderRelease: (_, gesture) => {
      const expand = gesture.vy < -0.25 || dragStart.value - gesture.dy > (mediumHeight + expandedHeight) / 2;
      Animated.spring(sheetHeight, { toValue: expand ? expandedHeight : mediumHeight, useNativeDriver: false, damping: 24, stiffness: 220 }).start();
    },
  }), [dragStart, expandedHeight, mediumHeight, sheetHeight]);

  const selectLocation = async (kind: Field, location: MapLocation) => {
    if (location.countryCode && !['NG', 'Nigeria'].includes(location.countryCode)) {
      setError('Ride is not available in this area yet. Choose a location in Nigeria.'); return;
    }
    if (kind === 'pickup') { setPickup(location); setPickupText(location.address); setPickupEdited(false); }
    else { setDropoff(location); setDropoffText(location.address); }
    setPredictions([]);
    const other = kind === 'pickup' ? dropoff : pickup;
    if (!other) return;
    const start = kind === 'pickup' ? location : other;
    const end = kind === 'dropoff' ? location : other;
    setLoadingEstimate(true); setError(null);
    try {
      const [route] = await Promise.all([getTripRoute(start, end), getTripEstimate(start, end)]);
      setRoute(route.coordinates);
    } catch { setError('Route and fare could not be loaded. Check your connection and retry.'); }
    finally { setLoadingEstimate(false); }
  };

  const choosePrediction = async (prediction: PlacePrediction) => {
    setSearching(true);
    try { await selectLocation(activeField, await getPlaceDetails(prediction.placeId)); }
    catch { setError('Could not load that place. Please try again.'); }
    finally { setSearching(false); }
  };

  const changeQuery = (field: Field, value: string) => {
    setActiveField(field); setPredictions([]); setError(null);
    if (field === 'pickup') { setPickupEdited(true); setPickupText(value); } else setDropoffText(value);
  };

  const swap = () => {
    setPickup(dropoff); setDropoff(pickup); setPickupText(dropoffText); setDropoffText(pickupText);
    if (pickup && dropoff) void selectLocation('dropoff', pickup);
  };

  return <Animated.View className="absolute bottom-0 left-0 right-0 rounded-t-[28px] bg-surface shadow-lg" style={{ height: sheetHeight }}>
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View {...panResponder.panHandlers} className="pb-sm pt-md">
        <View className="items-center pb-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
        <View className="flex-row items-center px-xl"><Pressable onPress={onClose}><Text variant="h3">←</Text></Pressable><Text variant="h3" className="ml-lg">Plan your ride</Text></View>
      </View>
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="px-xl pb-md">
        <View className="relative gap-md">
          <AddressSearchInput active={activeField === 'pickup'} label="From" placeholder="Pickup location" value={displayedPickup} loading={searching && activeField === 'pickup'} onFocus={() => setActiveField('pickup')} onChangeText={(value) => changeQuery('pickup', value)} />
          <AddressSearchInput active={activeField === 'dropoff'} label="To" placeholder="Where are you going?" value={dropoffText} loading={searching && activeField === 'dropoff'} onFocus={() => setActiveField('dropoff')} onChangeText={(value) => changeQuery('dropoff', value)} />
          <Pressable accessibilityLabel="Swap pickup and destination" onPress={swap} className="absolute left-1/2 top-1/2 -ml-4 -mt-4 h-8 w-8 items-center justify-center rounded-full bg-primary shadow-sm">
            <Text variant="bodyMedium" color="textInverse">⇅</Text>
          </Pressable>
        </View>

        {(activeField === 'pickup' && current) || predictions.length || error ? <View className="mt-sm bg-surface">
          {activeField === 'pickup' && current ? <Pressable onPress={() => void selectLocation('pickup', current)} className="flex-row gap-md border-b border-border p-md"><Text color="primary">◎</Text><Text variant="bodyMedium">Use current location</Text></Pressable> : null}
          {predictions.map((item) => <Pressable key={item.placeId} onPress={() => void choosePrediction(item)} className="border-b border-border px-md py-sm"><Text variant="bodyMedium">{item.primaryText}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{item.secondaryText}</Text></Pressable>)}
          {error ? <Text variant="caption" color="textMuted" className="p-md">{error}</Text> : null}
        </View> : null}

        {error && pickup && dropoff ? <Pressable onPress={() => void selectLocation('dropoff', dropoff)} className="self-end py-sm"><Text variant="caption" color="primary">Retry estimate</Text></Pressable> : null}
      </ScrollView>
      <View className="border-t border-border px-xl pb-xl pt-md"><Button label={loadingEstimate ? 'Calculating…' : 'Find Now'} fullWidth loading={loadingEstimate} disabled={!pickup || !dropoff || loadingEstimate} onPress={onFindRide} /></View>
    </KeyboardAvoidingView>
  </Animated.View>;
}
