# API Endpoints Reference

Keep this updated as routes are added. Full request/response shapes can move to
an OpenAPI/Swagger spec later if the API grows large — this file is the readable
quick-reference for now.

## Auth
| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | /api/auth/signup | No | Create account |
| POST | /api/auth/login | No | Login, returns JWT |

## Trips
| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | /api/trips/request | Yes | Rider requests a trip |
| PATCH | /api/trips/:id/status | Yes | Update trip status (validated transitions) |
| POST | /api/trips/route | Planned | Return encoded route, distance, and duration |
| POST | /api/trips/estimate | Planned | Return distance, ETA, and server-calculated fare |

## Maps and Places

| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | /api/places/autocomplete | Planned | Nigeria-biased Places suggestions |
| POST | /api/places/details | Planned | Resolve a place ID to address and coordinates |
| POST | /api/geocode/reverse | Planned | Resolve coordinates to a formatted address |

## Location
| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | /api/location/nearby | Planned | Redis GEOSEARCH around rider coordinates |

Driver GPS updates are sent through Socket.io as `driver:location:update`, not
through an HTTP endpoint. Production auth middleware is still pending, so the
new map endpoints must be protected before deployment.

## Payments
| Method | Path | Auth required | Description |
|---|---|---|---|
| _TBD_ | | | Not yet implemented |

## Ratings
| Method | Path | Auth required | Description |
|---|---|---|---|
| _TBD_ | | | Not yet implemented |
