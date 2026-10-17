import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiErrorMessage } from '@/lib/apiClient';
import { estimateTrip, type TripEstimate } from '@/services/tripService';
import type { MapLocation } from '@/store/mapStore';

type VehicleType = 'economy' | 'courier';
type QuoteState = {
  pickup: MapLocation;
  dropoff: MapLocation;
  vehicleType: VehicleType;
  value: TripEstimate | null;
  error: string | null;
};
type FareChange = { pickup: MapLocation; dropoff: MapLocation; vehicleType: VehicleType; previousFareKobo: number; newFareKobo: number };

const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MIN_RENEW_INTERVAL_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 30_000;

export function useTripQuote(pickup: MapLocation | null, dropoff: MapLocation | null, vehicleType: VehicleType = 'economy') {
  const [state, setState] = useState<QuoteState | null>(null);
  const [fareChange, setFareChange] = useState<FareChange | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(false);
  const latestEndpoints = useRef({ pickup, dropoff, vehicleType });
  const lastQuote = useRef<QuoteState | null>(null);
  const inFlight = useRef<{ pickup: MapLocation; dropoff: MapLocation; vehicleType: VehicleType; promise: Promise<TripEstimate> } | null>(null);
  const current = state?.pickup === pickup && state.dropoff === dropoff && state.vehicleType === vehicleType ? state : null;
  const estimate = current?.value ?? null;
  const currentFareChange = fareChange?.pickup === pickup && fareChange.dropoff === dropoff && fareChange.vehicleType === vehicleType ? fareChange : null;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { latestEndpoints.current = { pickup, dropoff, vehicleType }; }, [pickup, dropoff, vehicleType]);

  const refresh = useCallback((): Promise<TripEstimate> => {
    if (!pickup || !dropoff) return Promise.reject(new Error('Choose pickup and destination first.'));
    if (inFlight.current?.pickup === pickup && inFlight.current.dropoff === dropoff && inFlight.current.vehicleType === vehicleType) {
      return inFlight.current.promise;
    }
    const isCurrent = () => mounted.current && latestEndpoints.current.pickup === pickup && latestEndpoints.current.dropoff === dropoff && latestEndpoints.current.vehicleType === vehicleType;
    const promise = estimateTrip(pickup, dropoff, vehicleType).then((value) => {
      if (isCurrent()) {
        const previous = lastQuote.current;
        if (previous?.pickup === pickup && previous.dropoff === dropoff && previous.vehicleType === vehicleType && previous.value && previous.value.fareKobo !== value.fareKobo) {
          setFareChange({ pickup, dropoff, vehicleType, previousFareKobo: previous.value.fareKobo, newFareKobo: value.fareKobo });
        }
        const next = { pickup, dropoff, vehicleType, value, error: null };
        lastQuote.current = next;
        setState(next);
      }
      return value;
    }).catch((error: unknown) => {
      if (isCurrent()) {
        setState((previous) => {
          const validPrevious = previous?.pickup === pickup && previous.dropoff === dropoff && previous.vehicleType === vehicleType && previous.value && Date.parse(previous.value.quoteExpiresAt) > Date.now();
          return { pickup, dropoff, vehicleType, value: validPrevious ? previous.value : null, error: apiErrorMessage(error) };
        });
      }
      throw error;
    }).finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = { pickup, dropoff, vehicleType, promise };
    return promise;
  }, [pickup, dropoff, vehicleType]);

  useEffect(() => {
    if (pickup && dropoff) void refresh().catch(() => undefined);
  }, [pickup, dropoff, refresh, retry]);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active' && (!estimate || Date.parse(estimate.quoteExpiresAt) <= Date.now() + RENEW_BEFORE_EXPIRY_MS)) {
        void refresh().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [pickup, dropoff, estimate, refresh]);

  useEffect(() => {
    if (!estimate) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        void refresh().catch(() => {
          if (active) schedule(RETRY_AFTER_FAILURE_MS);
        });
      }, delay);
    };
    schedule(Math.max(MIN_RENEW_INTERVAL_MS, Date.parse(estimate.quoteExpiresAt) - Date.now() - RENEW_BEFORE_EXPIRY_MS));
    return () => { active = false; clearTimeout(timer); };
  }, [estimate, refresh]);

  const ensureFresh = useCallback(async (): Promise<TripEstimate> => {
    const previous = lastQuote.current;
    if (previous?.pickup === pickup && previous.dropoff === dropoff && previous.vehicleType === vehicleType && previous.value &&
        Date.parse(previous.value.quoteExpiresAt) > Date.now() + RENEW_BEFORE_EXPIRY_MS) return previous.value;
    return refresh();
  }, [pickup, dropoff, vehicleType, refresh]);

  return {
    estimate,
    error: current?.error ?? null,
    fareChange: currentFareChange,
    clearFareChange: () => setFareChange(null),
    retry: () => setRetry((value) => value + 1),
    refresh,
    ensureFresh,
  };
}
