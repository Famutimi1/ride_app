# Scheduled rides

Riders can choose a pickup time in **Lagos time (WAT, UTC+1)** from 30 minutes to 7 days ahead. The booking uses the normal address search, route estimate, ride choice, and payment selection. The confirmation screen shows the chosen time and explains that a driver is not guaranteed until one accepts.

The API stores advance bookings in `trips` with `status='scheduled'` and `scheduled_at`. No separate table or live driver reservation is created. Booking does not put a wallet hold on funds. The existing `trip_status_history` records creation and every subsequent transition.

Every 30 seconds, the trip worker checks for scheduled trips within 5 minutes of pickup. It changes them through the state machine to `searching`, updates `requested_at`, holds the fare for wallet rides, then queues the existing driver matching flow. The worker checks for searches that were activated but not queued after a crash. It retries when no driver is nearby, searching until 5 minutes after pickup; an offer already sent at the deadline remains valid until its own timeout. If wallet funds are insufficient, the wallet is unavailable, or the rider is already on another trip, the scheduled ride is cancelled with a specific reason. If no driver accepts by the end of the search window, the trip becomes `no_drivers_found`. These outcomes appear on the Schedule screen for 24 hours.

Riders can cancel a booking before driver search starts from Schedule. Once search starts, the existing live trip screen handles cancellation. The backend prevents overlapping future bookings by the same rider, using a row lock on `users` during creation.

Deployment order: run `npm run migrate` in `backend`, build and restart the backend so the scheduled worker starts, then ship the mobile update. The local database has already had migration `004_scheduled_trips.sql` applied. A scheduled booking still depends on a running backend, PostgreSQL, and Redis at activation time; it is not a guaranteed reservation or preassigned driver.
