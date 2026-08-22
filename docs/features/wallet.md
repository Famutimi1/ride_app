# Feature: Wallet

## What it does
Driver-facing balance view, backed by the append-only wallet_transactions ledger.

## Key files
- Backend: /src/modules/payments/* (wallet logic currently lives here — split out if it grows)
- Frontend: /src/screens/shared/WalletScreen.js

## Design notes
Wallet screen colors carry financial meaning (success/warning/danger) — preserve
semantic mapping in any palette/reskin work. See AGENTS.md Section 7.

## Status
- [ ] Not yet implemented
