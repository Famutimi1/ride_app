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

## Location
| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | /api/location/update | Yes | Driver sends GPS ping |

## Payments
| Method | Path | Auth required | Description |
|---|---|---|---|
| _TBD_ | | | Not yet implemented |

## Ratings
| Method | Path | Auth required | Description |
|---|---|---|---|
| _TBD_ | | | Not yet implemented |
