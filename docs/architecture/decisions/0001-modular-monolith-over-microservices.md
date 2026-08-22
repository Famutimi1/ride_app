# ADR 0001: Modular Monolith over Microservices

**Status:** Accepted

## Context
Ride-hailing systems (like Uber) are often associated with microservices
architecture at scale.

## Decision
Start as a modular monolith with clean internal module boundaries
(`/modules/auth`, `/modules/trips`, etc.), not separate deployed services.

## Reasoning
Microservices solve organizational problems (many teams needing independent
deploys) more than technical ones at this project's size. Splitting now would add
network overhead, distributed transaction complexity, and DevOps burden without a
corresponding benefit. Clean module boundaries preserve the option to split later.

## Consequences
- Faster to build and reason about now
- Must maintain module discipline (no cross-module DB access, no tangled imports)
  so a future split stays possible
