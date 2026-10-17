import { create } from 'zustand';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapLocation extends MapCoordinate {
  address: string;
  placeId?: string;
  countryCode?: string;
}

export interface DriverMapLocation extends MapCoordinate {
  driverId: string;
  heading?: number;
  timestamp: number;
}

export interface MapRegion extends MapCoordinate {
  latitudeDelta: number;
  longitudeDelta: number;
}

export const LAGOS_REGION: MapRegion = {
  latitude: 6.4474,
  longitude: 3.4723,
  latitudeDelta: 0.08,
  longitudeDelta: 0.06,
};

interface MapState {
  pickupLocation: MapLocation | null;
  dropoffLocation: MapLocation | null;
  currentLocation: MapLocation | null;
  driverLocations: DriverMapLocation[];
  driverLocationsService:'ride'|'courier'|null;
  routeCoordinates: MapCoordinate[];
  cameraRegion: MapRegion;
  locating: boolean;
  setPickupLocation: (location: MapLocation | null) => void;
  setDropoffLocation: (location: MapLocation | null) => void;
  setCurrentLocation: (location: MapLocation | null) => void;
  setDriverLocations: (locations: DriverMapLocation[], service?:'ride'|'courier') => void;
  upsertDriverLocation: (location: DriverMapLocation) => void;
  setRouteCoordinates: (coordinates: MapCoordinate[]) => void;
  setRouteForEndpoints: (pickup: MapCoordinate, dropoff: MapCoordinate, coordinates: MapCoordinate[]) => void;
  setCameraRegion: (region: MapRegion) => void;
  setLocating: (locating: boolean) => void;
  clearTripMap: () => void;
  clearUserLocation: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  pickupLocation: null,
  dropoffLocation: null,
  currentLocation: null,
  driverLocations: [],
  driverLocationsService:null,
  routeCoordinates: [],
  cameraRegion: LAGOS_REGION,
  locating: false,
  setPickupLocation: (pickupLocation) => set((state) => ({
    pickupLocation,
    routeCoordinates: sameCoordinate(state.pickupLocation, pickupLocation) ? state.routeCoordinates : [],
  })),
  setDropoffLocation: (dropoffLocation) => set((state) => ({
    dropoffLocation,
    routeCoordinates: sameCoordinate(state.dropoffLocation, dropoffLocation) ? state.routeCoordinates : [],
  })),
  setCurrentLocation: (currentLocation) => set({ currentLocation }),
  setDriverLocations: (driverLocations,driverLocationsService='ride') => set({ driverLocations,driverLocationsService }),
  upsertDriverLocation: (location) => set((state) => ({
    driverLocations: [...state.driverLocations.filter((item) => item.driverId !== location.driverId), location],
  })),
  setRouteCoordinates: (routeCoordinates) => set({ routeCoordinates }),
  setRouteForEndpoints: (pickup, dropoff, routeCoordinates) => set((state) =>
    sameCoordinate(state.pickupLocation, pickup) && sameCoordinate(state.dropoffLocation, dropoff)
      ? { routeCoordinates }
      : state),
  setCameraRegion: (cameraRegion) => set({ cameraRegion }),
  setLocating: (locating) => set({ locating }),
  clearTripMap: () => set({ dropoffLocation: null, routeCoordinates: [], driverLocations: [],driverLocationsService:null }),
  clearUserLocation: () => set({ currentLocation: null, pickupLocation: null, dropoffLocation: null, routeCoordinates: [], driverLocations: [],driverLocationsService:null, cameraRegion: LAGOS_REGION, locating: false }),
}));

function sameCoordinate(a: MapCoordinate | null, b: MapCoordinate | null): boolean {
  return a === b || Boolean(a && b && a.latitude === b.latitude && a.longitude === b.longitude);
}
