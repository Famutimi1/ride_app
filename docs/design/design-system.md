# Design System

The single source of truth for how the app looks: colours, typography, spacing,
and the base components. It was derived from the approved screen-by-screen design
mockup and is implemented as code in `mobile/src/constants/` +
`mobile/src/components/common/`.

**Golden rule:** screens never hardcode a hex colour, a font size, or a pixel
padding. They read everything from the theme via the `useTheme()` hook. That
indirection is what makes light/dark mode and future re-skins a one-file change.

```tsx
import { useTheme } from '@/constants/theme';
import { Text, Button, Card } from '@/components/common';

function Example() {
  const theme = useTheme();
  return (
    <Card>
      <Text variant="h3">Fare estimate</Text>
      <Text variant="body" color="textMuted">Est. 12 min</Text>
      <Button label="Confirm" onPress={...} />
    </Card>
  );
}
```

---

## 1. Where it lives

| File | What it holds |
|---|---|
| `mobile/src/constants/colors.ts` | Raw palette + light/dark semantic tokens |
| `mobile/src/constants/typography.ts` | The Inter type scale |
| `mobile/src/constants/spacing.ts` | Spacing, radius, elevation scales |
| `mobile/src/constants/theme.ts` | `useTheme()` hook that assembles the above |
| `mobile/src/components/common/` | Base components (Text, Button, Input, …) |

---

## 2. Colour

Rakky Ride uses forest green actions on white/silver light surfaces and brighter
green actions on charcoal dark surfaces. All runtime values, including opaque
status tints, overlays, and shadows, live in the `palette` in
`mobile/src/constants/colors.ts`. Semantic `lightColors` and `darkColors`
share the same keys. NativeWind and `useTheme()` consume those mappings.

- `primary`: actions, links, focus, selected state.
- `secondary`, `textMuted`, `icon`: supporting content.
- `success`: online, paid, completed, earnings-in; distinct from brand green.
- `warning`: pending/warnings and amber star ratings.
- `danger`: decline, failed, cancelled, earnings-out.
- `primarySoft`, `successSoft`, `warningSoft`, `dangerSoft`: paired tinted surfaces.
- `background`, `surface`, `surfaceMuted`: page, card/sheet, and filled control surfaces.
- `border`: separators; `borderStrong`: visible control boundaries.
- `text`: body/headings; `textInverse`: labels on filled controls. Inverse text is
  white in light mode and charcoal in dark mode, paired with each theme's fills.
- `overlay`, `skeleton`: modal dimming and loading placeholders.
- `mapPickup`, `mapDropoff`, `mapDriver`, `mapNearbyDriver`: green, red, teal,
  and neutral markers; retain their distinct shapes and titles.

See [brand specification](brand/theme-spec.md) and
[measured contrast pairs](brand/theme-contrast.json). All 22 tested pairs pass their
4.5:1 text or 3:1 boundary targets. Always retest after palette changes.

The default is light. Settings exposes Light, Dark, and System; persisted choices
survive restarts. System follows the OS. Never reset storage as part of a reskin.

Native splash backgrounds come from `nativeBrandColors` through
`mobile/app.config.ts`; native appearance follows the OS until JS hydrates the
saved app preference. The original logo is preserved at
`mobile/assets/images/brand/rakky-ride-logo.png`. `BrandLogo` centers its visible
shield using layout without editing its pixels. SVG onboarding artwork uses fixed
export colors and has been aligned to the green palette.

---

## 3. Typography

Font: **Inter** (loaded at app start in `src/app/_layout.tsx` via
`@expo-google-fonts/inter`). Each variant points at a specific Inter weight file —
on custom fonts the *family name* carries the weight, so we don't rely on
`fontWeight` alone.

| Variant | Size / Line height | Weight | Inter family | Use |
|---|---|---|---|---|
| `h1` | 38 / 44 | 700 | `Inter_700Bold` | Big screen titles, balances |
| `h2` | 32 / 40 | 700 | `Inter_700Bold` | Screen titles |
| `h3` | 28 / 36 | 600 | `Inter_600SemiBold` | Section headers, prices |
| `body` | 16 / 24 | 400 | `Inter_400Regular` | Default body text |
| `bodyMedium` | 16 / 24 | 500 | `Inter_500Medium` | Emphasised body / list titles |
| `caption` | 14 / 20 | 400 | `Inter_400Regular` | Secondary / helper text |
| `button` | 15 / 22 | 500 | `Inter_500Medium` | Button labels |

Sizes come straight from the mockup's typography table. `body` and `bodyMedium`
are the one addition — the mockup showed H1–H3 + caption + button but every screen
needs a standard 16px body size, so it sits in the natural gap below H3.

Usage — always via the `<Text>` component, never a raw `fontSize`:

```tsx
<Text variant="h1">Good morning</Text>
<Text variant="caption" color="textMuted">3 trips today</Text>
```

---

## 4. Spacing, radius, elevation

**Spacing** (`spacing.*`) — use for padding, margin, gap:

| Token | px |  | Token | px |
|---|---|---|---|---|
| `xs` | 4 |  | `xl` | 24 |
| `sm` | 8 |  | `2xl` | 32 |
| `md` | 12 |  | `3xl` | 48 |
| `lg` | 16 | | | |

**Radius** (`radius.*`): `xs` 3 · `sm` 6 · `md` 8 · `lg` 10 · `xl` 12 ·
`full` 9999 (pills, avatars, circular buttons). Content containers use the
compact scale; draggable and bottom screen sheets keep their larger top-only
corner radius so their sheet silhouette remains clear.

**Elevation** (`elevation.*`): `none` · `sm` · `md` · `lg`. Each preset sets both
iOS `shadow*` props and Android `elevation` so cards look right on both platforms.
Shadows are barely visible on dark backgrounds — that's expected.

---

## 5. Base components

All in `mobile/src/components/common/`, all theme-aware. Import from the barrel:
`import { Text, Button, Input, Card, StatusPill, Avatar, RatingStars, Skeleton } from '@/components/common';`

| Component | Key props | Notes |
|---|---|---|
| `Text` | `variant`, `color` | Themed replacement for RN `<Text>`. `color` = any semantic token. |
| `Button` | `label`, `variant`, `size`, `loading`, `fullWidth`, `leftIcon`/`rightIcon` | Variants: `primary` · `secondary` · `ghost` · `destructive`. Handles pressed/disabled/loading. |
| `Input` | `label`, `error`, `leftIcon`/`rightIcon` | 3 states: default / focused (green border) / error (red). |
| `Card` | `elevation`, `padding` | Rounded themed surface panel. |
| `StatusPill` | `label`, `tone`, `dot` | Tones: `success`/`primary`/`warning`/`danger`/`neutral`. For "Online", "Searching…", etc. |
| `Avatar` | `uri`, `name`, `size` | Photo, or initials fallback on a tinted circle. |
| `RatingStars` | `value`, `interactive`, `onChange` | Amber stars; display or input. |
| `Skeleton` | `width`, `height`, `radius` | Pulsing loading placeholder (Reanimated). |

> Icons: not yet standardised on a library. `RatingStars` uses a Unicode ★ glyph
> for now to avoid adding a dependency prematurely. If/when we adopt
> `@expo/vector-icons`, swap the glyph there — the component APIs won't change.
> (Adding an icon library is a dependency decision → flag it per AGENTS.md.)

---

## 6. Live preview

The app now boots into the **Auth flow** (Welcome → phone → OTP → profile), so the
old component gallery is no longer the entry screen. It still exists as a dev-only
reference — `mobile/src/screens/dev/ComponentGalleryScreen.tsx`, reachable at the
route **`/gallery`** (not linked from anywhere; navigate to it manually). It renders
every component so you can eyeball the system and toggle light/dark.

## 7. Verification and remaining work

TypeScript checking and lint pass. The baseline and remaining release-build checks are
tracked in [the execution report](brand/execution-report.md). Browser previews do
not validate native launch. Address-search race handling and the trip-sheet
responder also pass focused regression checks; final device interaction checks remain open.
