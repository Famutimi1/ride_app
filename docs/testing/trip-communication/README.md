# Virtual messaging browser test

Run on 24 October 2026 against the actual Expo web app at `http://localhost:8081`, using two isolated Chromium sessions for a fictional rider and driver.

All 8 checks passed:

1. Both assigned participants load the chat screen.
2. The rider sends a message that the driver receives and PostgreSQL persists once.
3. The driver replies and the rider receives it.
4. Both participants see Read receipts.
5. Reloading retains message history without duplicate bubbles.
6. A send during simulated API disconnection remains Pending, then retries after reconnection with one persisted record.
7. Completing the test trip makes both conversations read-only while preserving history.
8. An unrelated authenticated account cannot read the conversation and receives HTTP 404.

Three messages were stored. There were no browser runtime errors or unexpected HTTP API errors. The first-run location education dialog was dismissed through the normal Not now action.

The repository's existing isolated-test harness created a temporary PostgreSQL database and a dedicated Redis process. Browser HTTP and Socket.IO traffic was bridged to the disposable backend only inside the two new test sessions. The user's existing browser, backend database, accounts, and trips were not modified. No real SMS, provider push, or payment requests were sent. Test services and data were removed after the run.

This verifies the web UI and real messaging backend together. It does not verify physical Android/iOS interaction, background push display, audio, or video calling.

- [Machine-readable results](virtual-test-results.json)
- [Rider screenshot](virtual-rider-chat.png)
- [Driver screenshot](virtual-driver-chat.png)

Both screenshots show the completed test trip, with read-only history and the three exchanged messages.
