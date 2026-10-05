export const SOCKET_EVENTS = {
  JOIN_TRIP: 'trip:join',
  DRIVER_LOCATION_UPDATE: 'driver:location:update',
  DRIVER_LOCATION: 'driver:location',
  DRIVER_OFFLINE: 'driver:offline',
  LOCATION_ERROR: 'location:error',
  TRIP_MESSAGE_SEND: 'trip:message:send',
  TRIP_MESSAGE: 'trip:message',
  TRIP_MESSAGE_ERROR: 'trip:message:error',
  TRIP_OFFER: 'trip:offer',
  TRIP_OFFER_CANCELLED: 'trip:offer_cancelled',
  TRIP_STATUS: 'trip:status',
  WALLET_UPDATED: 'wallet:updated',
} as const;
