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
  routeCoordinates: MapCoordinate[];
  cameraRegion: MapRegion;
  locating: boolean;
  setPickupLocation: (location: MapLocation | null) => void;
  setDropoffLocation: (location: MapLocation | null) => void;
  setCurrentLocation: (location: MapLocation | null) => void;
  setDriverLocations: (locations: DriverMapLocation[]) => void;
  upsertDriverLocation: (location: DriverMapLocation) => void;
  setRouteCoordinates: (coordinates: MapCoordinate[]) => void;
  setCameraRegion: (region: MapRegion) => void;
  setLocating: (locating: boolean) => void;
  clearTripMap: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  pickupLocation: null,
  dropoffLocation: null,
  currentLocation: null,
  driverLocations: [],
  routeCoordinates: [],
  cameraRegion: LAGOS_REGION,
  locating: false,
  setPickupLocation: (pickupLocation) => set({ pickupLocation }),
  setDropoffLocation: (dropoffLocation) => set({ dropoffLocation }),
  setCurrentLocation: (currentLocation) => set({ currentLocation }),
  setDriverLocations: (driverLocations) => set({ driverLocations }),
  upsertDriverLocation: (location) => set((state) => ({
    driverLocations: [...state.driverLocations.filter((item) => item.driverId !== location.driverId), location],
  })),
  setRouteCoordinates: (routeCoordinates) => set({ routeCoordinates }),
  setCameraRegion: (cameraRegion) => set({ cameraRegion }),
  setLocating: (locating) => set({ locating }),
  clearTripMap: () => set({ dropoffLocation: null, routeCoordinates: [], driverLocations: [] }),
}));
