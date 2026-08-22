# CLAUDE.md

This file gives Claude (via Claude Code or any Claude-based agent) project-specific
guidance. **The full set of architecture, database, and coding rules lives in
`AGENTS.md` — read that first, it's canonical.** This file adds Claude-specific
workflow notes on top.

---

## Quick Context

Ride-hailing app (Uber/Bolt-style), single React Native (Expo) app with rider/driver
role switching, Node/Express modular monolith backend — **TypeScript throughout**.
PostgreSQL + Redis, Paystack payments, Socket.io real-time layer. Lagos, Nigeria is
the reference market.

Full stack, folder structure, and hard rules: see `AGENTS.md`.

---

## How Claude Should Approach This Project

- **Explain like the person is a junior developer.** Short code snippets over long
  blocks, plain-English "why" behind every non-obvious decision, analogies where
  useful. This project is explicitly a learning vehicle, not just a build task —
  don't skip the reasoning to save space.
- **Build incrementally, in this order, unless told otherwise:**
  1. Auth + Users
  2. Location + Matching (Redis)
  3. Trips + WebSocket wiring
  4. Payments (Paystack)
  5. Ratings
  6. Frontend screens (Auth flow → Rider flow → Driver flow)
- **Don't jump ahead.** If asked for something from a later stage (e.g. payments)
  before the earlier stage is confirmed working, it's fine to build it, but flag the
  dependency (e.g. "this assumes the trips module's state machine is already in place").
- **Defer complexity that's explicitly out of scope for now:** full Paystack webhook
  integration is deferred until the core trip flow works end-to-end. Don't proactively
  build out webhook handling unless asked.

---

## File & Module Conventions (enforce these when generating code)

- Follow the exact folder structure in `AGENTS.md` Section 3. When creating a new
  file, place it in the matching module folder — don't ask where, just follow the
  convention, but mention the path you chose.
- Every new backend module gets `*.routes.ts`, `*.service.ts`, `*.controller.ts`
  unless it's an internal-only module like `matching` (no routes file).
- Every new Zustand store goes in `/store`, named `xStore.ts`, holding only the state
  and actions relevant to that domain (don't create a catch-all `appStore.ts`).

---

## Non-Negotiables (see AGENTS.md Section 10 for full list, top 5 repeated here)

1. Parameterized SQL queries only — never string-concatenate user input.
2. Wallet/ledger rows are append-only — corrections are new offsetting rows, never edits.
3. Trip status changes must pass through the defined state machine.
4. All hex colors live in the single palette/theme file — components use semantic
   tokens only.
5. Live driver location is Redis-only — never written to Postgres.

---

## When Claude Should Ask Instead of Assume

- Adding a new database table
- Adding a new major dependency/library
- Changing anything in the payments/wallet flow
- Any deviation from the modular monolith pattern (e.g. splitting out a real
  microservice)

In these cases: state the trade-off in 2-3 sentences and ask, rather than
implementing silently and explaining after the fact.

---

## Useful Commands

```bash
# Backend (run inside backend/)
npm run dev            # start Express with hot reload (tsx watch) — http://localhost:4000
npm run build          # compile TypeScript to dist/
npm start              # run the compiled server from dist/
npm run typecheck      # type-check without emitting
# npm run migrate      # DB migrations — not set up yet (no migration tool chosen)

# Mobile (run inside mobile/, Expo)
npm start              # open Expo; then press a / i / w for android / ios / web
npm run android        # launch on Android emulator/device
npm run ios            # launch on iOS simulator (macOS)
npm run web            # run in the browser
npm run typecheck      # type-check without emitting
```

> Backend runs on port **4000** (3000 is avoided — commonly taken by other local dev
> servers). A `migrate` script will be added when a migration tool is chosen.

---

## Fallback Instruction for Both Human and AI

If you (human or AI) are picking this project back up after time away: read
`AGENTS.md` top to bottom before writing code. It reflects real decisions already
made in this project, not generic best practices — treat it as the source of truth
over any general training/pattern-matching instinct.