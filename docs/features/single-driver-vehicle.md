# One vehicle per driver account

Drivers register one car or motorcycle. A car can apply for passenger rides, courier deliveries, or both. A motorcycle can apply for courier only. Each service still needs its own approval and consent.

The existing `driver_profiles.user_id` unique constraint provides one vehicle record per account. Additional service applications reuse its vehicle details and private document references; no vehicle table, duplicate vehicle record, or second document upload is introduced.

## Application and dashboard behavior

- Onboarding asks for vehicle type before showing service choices. A saved category cannot be switched through another service application, including a rejected application.
- Service applications show the registered vehicle instead of another vehicle picker. Approved services stay independent while another service is reviewed.
- Motorcycle accounts show courier controls only. Mobile request toggles, online checks and offer presentation also validate the category, approval and consent, including stale settings.
- Approved vehicle edits remain locked. Vehicle & documents directs replacement requests to support for review; there is no self-service vehicle replacement or second-vehicle registration.

## Existing accounts and deployment

Migration `019_single_driver_vehicle.sql` updates the shared `driver_service_enabled` predicate used by nearby supply, matching, offer recovery, availability and acceptance. Only a classified car can receive passenger jobs; a classified car or motorcycle can receive courier jobs.

Unclassified legacy accounts keep their existing vehicle, approvals and consent history. They receive `vehicleReviewRequired: true`, have no operational services enabled, and see a support action. Staff must inspect the existing evidence and classify the vehicle through the audited application review. Make/model is never used to guess a category. Existing accepted jobs remain accessible so they can be completed.

Deploy the backend migration before the corresponding mobile release. For a compiled deployment, use the existing `npm run migrate:deploy` step. Publishing mobile code alone does not update server eligibility.

Migration `020_vehicle_category_enum.sql` converts `driver_profiles.vehicle_category` from restricted text to the PostgreSQL enum `vehicle_category` (`car`, `motorcycle`). Existing values and unclassified `NULL` values are preserved. The enum rejects other categories, and the separate constraint still prevents motorcycles from holding pending/approved passenger access or enabling passenger requests. This conversion does not classify or approve any account.

## Verification

The service integration suite uses disposable PostgreSQL/Redis instances to verify vehicle/document reuse, the unique profile constraint, category changes rejected through pending/rejected applications, motorcycle request restrictions, unknown vehicle review, independent service approvals, stale offers and concurrent acceptance of only one active job. Mobile tests exercise the actual service choices, enrollment view, preference controller and offer overlay with controlled I/O.
