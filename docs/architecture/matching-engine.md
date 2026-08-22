# Matching Engine

## Flow
1. Rider requests trip → query Redis GEO for nearby drivers
2. Filter by online status + not already locked to a trip
3. Attempt lock: `SET driver:{id}:onTrip {tripId} NX EX 60`
4. First successful lock wins — trip proceeds
5. If no drivers available, return a clear "no drivers nearby" error to the rider

## Why the NX lock matters
Prevents two riders from being matched to the same driver in a race condition.
See `AGENTS.md` Section 4 for the full reasoning.

## Open questions / future improvements
- Driver rating/vehicle-type filtering priority order
- Surge pricing trigger logic
- What happens if the matched driver doesn't respond within N seconds (timeout + re-match)
