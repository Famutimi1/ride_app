# Google Maps integration

## Scope

The app now has a shared maps foundation for rider and driver experiences. It covers native map rendering, location permissions, Places search, reverse geocoding, route previews, fare and ETA estimates, nearby drivers, and Socket.io live-coordinate delivery.

Google web-service calls are made by Express with `GOOGLE_MAPS_API_KEY`. The mobile application never calls Directions, Distance Matrix, Geocoding, or Places directly.

## Mobile implementation

### Shared map

`mobile/src/components/map/AppMap.tsx` is the canonical map component. Both roles must reuse it rather than introduce another map implementation.

Supported inputs:

- Lagos fallback region so the map never starts at `(0, 0)`.
- Pickup, drop-off, rider, active-driver, and nearby-driver markers.
- Decoded route coordinates rendered as a polyline.
- User-location following and display.
- Region-change callbacks for pin-drop selection.
- Map padding for overlapping sheets.
- Route camera fitting through the exposed map handle.
- Light and dark Google map styles from `mobile/src/constants/colors.ts`.

On web, it renders a Google Maps embed. Android and custom iOS builds use the Google provider. iOS Expo Go uses Apple Maps because Expo Go cannot include the project's native Google Maps key.

### Map state

`mobile/src/store/mapStore.ts` owns:

- `currentLocation`
- `pickupLocation`
- `dropoffLocation`
- `driverLocations`
- `routeCoordinates`
- `cameraRegion`
- the current locating state

Locations use `{ address, latitude, longitude, placeId, countryCode }`. Cross-screen map data should not be prop-drilled.

### Destination flow

`mobile/src/screens/rider/SetDestinationScreen.tsx` is a separate route from Home. It provides:

1. A pre-permission explanation at signed-in app startup before the native foreground prompt.
2. GPS lookup and reverse geocoding to prefill pickup.
3. Manual pickup search when permission is denied.
4. An Open Settings action when permission can no longer be requested.
5. A fixed center pin with a 500 ms reverse-geocode debounce.
6. Nearby-driver refresh around the current pickup.
7. A draggable, expandable address sheet.

`AddressSearchInput.tsx` provides the shared bordered pickup/destination field. `AddressSheet.tsx` debounces Places requests by 300 ms and renders one shared suggestion panel beneath the combined address container. It supports a pinned current-location option and explicit loading, no-result, and failure states. Results are biased to Nigeria and the user's current coordinates.

The destination sheet intentionally omits a visible estimate card; route and fare
data are still fetched and cached for the next confirmation step. The compact
swap control sits between the pickup and destination fields.

`LocationBootstrap.tsx` checks the OS permission at each signed-in launch. When
permission is already granted it refreshes the current coordinate immediately;
otherwise it presents the app-owned explanation once and persists that the
explanation has been seen. The operating system remains the source of truth for
the permission decision.

After both locations are selected, `AddressSheet.tsx` requests the route and estimate once and offers retry on failure. The estimate is cached in memory for 60 seconds and displayed on the following ride-selection screen.

### Ride selection and payment

Selecting **Find Now** opens the dedicated `/ride-selection` route implemented
by `mobile/src/screens/rider/RideSelectionScreen.tsx`. It keeps the route map
visible while presenting Economy, Comfort, and XL tiers with pickup ETA, seat
count, vehicle description, discounted price, and selected-state styling.

The fixed bottom action area displays the active payment method. Opening it
shows a themed payment sheet with Cash, Paystack card, and Ride wallet choices.
Payment selection is local UI state at this stage; actual payment authorization
remains part of the trip-request/payment workflow.

The first tap on an unselected vehicle highlights it for quick confirmation;
tapping the highlighted vehicle opens `/ride-details?ride=<tier>`. The detail screen combines
the route map with a vehicle overview, demand notice, editable fare offer,
distance/time and fee breakdown, payment selection, nearest-driver auto-accept,
pickup/drop-off summary, and fixed request action.

Both the selection-page action and ride-detail request action open the shared
`RideConfirmationModal.tsx`. It presents a final vehicle, fare, pickup,
drop-off, ETA, payment, and safety summary before confirming the request. The
secondary action returns to editing without losing the selected options.

After confirmation, `DriverResponseModal.tsx` replaces the confirmation with a
compact loading state. It shows the requested ride and fare while the nearest
verified driver reviews the request, explains that the rider will be notified
on acceptance or decline, and provides a cancellation action. When backend trip
matching is connected, the trip-room acceptance/decline events should drive the
next screen from this waiting state.

### Location tracking

`mobile/src/services/locationService.ts` owns foreground and background permissions and location watchers.

- Foreground driver updates use approximately four-second or ten-metre thresholds.
- Background tracking is started only when the driver turns online.
- The background task is defined at module scope, as required by Expo TaskManager.
- Driver identity and active trip context are persisted for background task execution.
- Driver mode is exposed through `DriverOnlineControl.tsx` for users whose role is `driver` or `both`.

Background tracking requires a development or production build. It is not available in iOS Expo Go.

### Live driver rendering

`mobile/src/services/socket.ts` joins `trip:{tripId}` and listens for driver coordinates. `useLiveDriverTracking.ts` interpolates between coordinate updates rather than snapping the marker. `driverAnimation.ts` calculates bearing and interpolation values so the active car marker can rotate with movement.

`useNearbyDrivers.ts` polls the Redis-backed nearby endpoint while the relevant rider screen is mounted.

## Backend implementation

### Google proxy

The maps module is under `backend/src/modules/maps`:

- `maps.routes.ts` defines HTTP routes.
- `maps.controller.ts` validates HTTP inputs and formats responses.
- `maps.service.ts` is the only code that talks to Google.

Google requests have an eight-second timeout. Errors are returned as JSON and do not crash Express.

### Trip routes and estimates

The trip module exposes route and estimate endpoints. The estimate formula is:

```text
base fare + (distance in km × per-km rate) + (duration in minutes × per-minute rate)
```

All rates come from backend environment variables. The client only receives the calculated result and never owns pricing rules.

Route deviation detection and live rerouting are intentionally future work.

### Redis and Socket.io

`backend/src/modules/location/location.service.ts` writes driver coordinates using `GEOADD`. It also refreshes the driver's online status and last coordinate with a 30-second TTL. No GPS ping is written to PostgreSQL.

`backend/src/websocket` attaches Socket.io to the same HTTP server as Express. Event names are constants. Driver updates are written to Redis and then pushed only to the matching `trip:{tripId}` room.

The current server is single-instance. Add the Socket.io Redis adapter before deploying two or more backend instances.

## Failure behaviour

- Denied location: manual address search remains available.
- Blocked location: Settings deep link is displayed.
- Places failure or quota exhaustion: manual map pin remains available.
- Route or estimate timeout: error and retry action are displayed.
- No Places results: an explicit empty-result message is displayed.
- Outside Nigeria: the selected address is rejected with a service-area message.
- Redis unavailable: nearby-driver requests fail without writing location to PostgreSQL.
- No initial GPS lock: the map remains centered on Lagos.

## Configuration still required

Google Cloud and local infrastructure are external configuration, not stored in source control. Before end-to-end testing:

1. Enable Maps SDK for Android, Maps SDK for iOS, Places API (New), Geocoding API, Directions API, and Distance Matrix API.
2. Add restricted Android and iOS keys to `mobile/.env`.
3. Add a separately restricted web-service key to `backend/.env` as `GOOGLE_MAPS_API_KEY`.
4. Start Redis and set `REDIS_URL`.
5. Use a custom development build for Google Maps on iOS and background driver tracking.
6. Set Google Cloud quotas and billing alerts.

See `docs/third-party/google-maps.md` for the exact environment layout.

## Verification performed

- Mobile ESLint passed.
- Mobile TypeScript passed.
- Backend TypeScript build passed.
- iOS production bundle export passed.
- Android production bundle export passed.
- Express health endpoint returned successfully on port 4000.
- The Google proxy returned its expected configuration error while the backend server key was absent.
## Ongoing trip experience

The signed-in `/ongoing-trip` route renders the active route, pickup, drop-off,
and driver marker through the shared `AppMap`. Its draggable trip sheet supports
collapsed, standard, and expanded heights and contains the ETA, driver and
vehicle identity, message/call/safety actions, route summary, payment, ride
sharing, and emergency help. It reads map state from `mapStore`, so live
Socket.io coordinates can update the active driver without another location
store.

For the current UI prototype, the waiting-for-driver state transitions to the
ongoing-trip route after five seconds. Replace that preview timer with the
`trip:accepted` Socket.io event when backend trip creation is enabled.
