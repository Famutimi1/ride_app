# Feature: Payments

## What it does
Charges rider, credits driver wallet minus platform commission, via Paystack.

## Key files
- Backend: /src/modules/payments/*
- Frontend: /src/services/paymentService.js, /src/screens/shared/WalletScreen.js

## How it works
See docs/architecture/wallet-ledger.md for the ledger design (append-only, FOR UPDATE locking).

## Status
- [x] Fare calculation
- [ ] Paystack charge integration
- [ ] Webhook handling
- [ ] Withdrawal + reconciliation cron
