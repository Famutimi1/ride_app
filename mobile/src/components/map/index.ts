/**
 * Barrel export for map components. Mirrors components/common so screens import
 * from a single path:
 *
 *   import { MapPlaceholder } from '@/components/map';
 *
 * The real map pieces (DriverMarker, RouteLine — see docs/architecture) land here
 * once we add a native maps library.
 */
export { MapPlaceholder } from './MapPlaceholder';
export type { MapPlaceholderProps } from './MapPlaceholder';
export { AddressSheet } from './AddressSheet';
export { RideMap } from './RideMap';
export { AppMap } from './AppMap';
export type { AppMapHandle, AppMapMarker, MarkerKind } from './AppMap';
export { AddressSearchInput } from './AddressSearchInput';
export { DriverOnlineControl } from './DriverOnlineControl';
export { LocationBootstrap } from './LocationBootstrap';
export { RideConfirmationModal } from './RideConfirmationModal';
export { DriverResponseModal } from './DriverResponseModal';
