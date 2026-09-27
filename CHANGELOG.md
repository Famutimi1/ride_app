# Changelog

All notable changes to this project. Newest at top.
Format: `## [date] — short summary` then bullet points.

## [Unreleased]
- Rakky Ride rebrand: supplied transparent logo, green/silver light theme,
  charcoal dark theme, native splash configuration, display name/icon sources,
  onboarding artwork, and product wording. Existing app identifiers are preserved.
- Appearance settings expose Light, Dark, and System. Launch hydration handles
  storage failures without persisting default state over an existing session.
- Address search discards stale results/errors after query changes or unmounting;
  the active-trip sheet keeps one gesture responder and restores its middle
  position after interruption. Typecheck and lint pass.
- Baseline screenshots, contrast results, and remaining release verification are
  tracked in `docs/design/brand/` and `docs/design/rakky-ride-rebrand-plan.md`.
- Project scaffolding created
