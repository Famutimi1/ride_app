# Account menu and role switching

## Routes

- `/menu` is the role-aware account menu opened by the rider home or driver
  dashboard menu button.
- `/account/[section]` renders detailed account destinations including profile,
  services, payment, trip history, support, safety, settings, Ride Plus, and
  driver tools.
- `/driver-dashboard` is the active driver-mode landing screen.

## State and behavior

Editable profile values update the persisted Zustand `authStore`. The role switch
uses the same store's `setRole` action and routes to the driver dashboard; switching
back restores rider mode and the rider home. Driver online/offline behavior reuses
`DriverOnlineControl`, including the foreground/background permission flow and
live coordinate service.

## Rider and driver information architecture

The menu is role-aware but presented as one continuous list without shared/tool
section headings. Rider mode is task-first: Profile, Ride history, Payment,
Services, Safety, Help & support, and Settings. Driver mode uses a consolidated
Wallet for earnings, balance, rewards, payout settings, and payout history, then
shows Driver trips and Vehicle & documents. Rider Services are intentionally
hidden in driver mode. Saved places, Promotions, Family Profile, and Work Profile
are intentionally hidden from the current rider menu.

The Services page showcases Ride, Courier, scheduled rides, airport trips, and
Ride Plus. Ride Plus remains fully accessible there rather than occupying a
primary-menu row.

This mirrors the mode-switching approach visible in inDrive and the operational
separation documented in Bolt's rider and driver support flows. Driver pages
prioritise transparent earnings, payout state, verification, and campaigns;
rider pages prioritise ride history, payments, and membership benefits.

Payment screens keep card handling behind Paystack. Until Paystack checkout and
the remaining account backend endpoints are connected, payment setup, support,
promo, family, and work actions provide complete prototype interactions and clear
success/help feedback without pretending to save server records.

## Product workflow reference

The information hierarchy follows familiar ride-hailing account patterns: profile,
payment, history, support, safety, places, and settings are kept prominent, while
membership, promotions, family/work profiles, and driver mode form a secondary
benefits group. Safety includes trusted contacts, live-trip sharing, private trip
context, and emergency access.
