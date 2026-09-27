# R02 — Rakky Ride theme specification

Direction: white-forward light mode and charcoal dark mode, both using the supplied
green/silver logo. Keep Inter, existing compact radii, and current sheet geometry.

## Color roles

The implementation source of truth is `mobile/src/constants/colors.ts`.

- Primary: forest green in light mode; brighter leaf green in dark mode. Primary
  fill and inverse foreground are a tested pair; links use the same primary token.
- Success: a cooler green for online, paid, completed, and earnings-in. Use words,
  icons, or money signs as well as color. It is never an alias of primary.
- Warning: readable amber for pending states and star ratings.
- Danger: red for cancellation, failure, and earnings-out, with a readable inverse
  foreground for filled destructive controls.
- Surfaces: white, soft silver-gray, charcoal, and a raised charcoal surface.
- Secondary text/icons: neutral gray, with stronger boundaries for form controls.
- Soft fills: opaque pale/charcoal tints, so contrast is stable on cards and sheets.
- Maps: forest pickup, red dropoff, teal active driver, neutral nearby drivers;
  preserve circle/square/triangle symbols and marker titles. Routes remain green.

All raw color values, including tints and overlays, belong in `palette`. Existing
semantic token names remain stable. `textInverse` is white on the deep fills in
light mode and charcoal on the brighter fills in dark mode. Review every filled
control against its paired foreground, including custom screen controls.

## Logo and launch

Use the second supplied PNG unchanged. Preserve its transparency and aspect ratio.
Do not redraw, recolor, or generate replacement lettering. A shared BrandLogo
component handles its visible placement in UI; native splash sizing accounts for
the transparent margins in the full source image.

Native splash: light surface for OS light mode, charcoal for OS dark mode. After
hydration, the saved app preference controls the first screen. A deliberate
light-to-dark or dark-to-light transition can occur when OS and saved preference
differ; native launch cannot access AsyncStorage before JS loads.

## Review surfaces

Use the existing `/gallery` for reusable component and logo previews in both
themes, followed by real welcome, booking, home, and wallet screen captures.
The gallery is a design reference, not a substitute for release-build launch QA.

Acceptance: normal text pairs at least 4.5:1; large text/essential control boundaries
at least 3:1. Record the calculated pairs in `theme-contrast.json` after implementation.
Keep actual Google Maps on map screens. No decorative illustration replaces a map.
