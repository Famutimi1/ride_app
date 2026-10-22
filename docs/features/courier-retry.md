# Retry an unsuccessful courier search

When a courier request ends with `no_drivers_found`, retry restores the package description, weight, recipient, instructions, original restriction acceptance, pickup, destination, place IDs, and available route geometry from that request before clearing the terminal trip from the client store.

Try again opens courier review with a new courier quote. Change pickup opens address selection with `service=courier` and retains the parcel. If an older request lacks courier details, the user returns to the courier form with the route retained; an unrelated draft is cleared. Ordinary ride retries continue to open ride selection.

Opening retry does not create a trip. The user reviews the current quote and confirms a new wallet-paid courier request through the existing submission flow. Delivery codes belong to their individual bookings: the failed trip's code is unavailable, and a newly confirmed request uses its own server-generated code. No backend matching, payment, or code-generation rules changed.

Verification: seven focused regression tests execute the actual mobile retry helper, stores, failed-search screen callbacks, courier form fallback, and review submission with controlled I/O. They cover courier/ride separation, restoration ordering, missing details, active-trip rejection, fresh courier quote/payload, and absence of an old trip/code in the new payload. Mobile typecheck and lint pass; the isolated test runner also compiles the backend. No real courier order was placed during verification.
