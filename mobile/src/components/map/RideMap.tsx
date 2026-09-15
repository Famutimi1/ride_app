import { AppMap } from './AppMap';
import { useMapStore } from '@/store/mapStore';

export function RideMap() {
  const region = useMapStore((state) => state.cameraRegion);
  const drivers = useMapStore((state) => state.driverLocations);
  return <AppMap region={region} markers={drivers.map((driver) => ({ ...driver, id: driver.driverId, kind: 'nearby-driver' as const }))} />;
}
