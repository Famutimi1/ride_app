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

Colour is layered so the app is re-skinnable and theme-aware:

1. **`palette`** — raw hex. The **only** place hex is allowed to exist.
2. **`brand` + `tint`** — semantic brand colours that mean the same thing in both
   themes (a primary button is blue in light *and* dark).
3. **`lightColors` / `darkColors`** — the same token names, mapped to light- or
   dark-appropriate values. `useTheme()` picks the right set for the OS scheme.

### Brand / status colours (same in light & dark)

| Token | Hex | Meaning |
|---|---|---|
| `primary` | `#1D4ED8` | Primary actions, links, active state |
| `secondary` | `#64748B` | Lower-emphasis actions/labels |
| `success` | `#16A34A` | Online, paid, earnings-in |
| `warning` | `#F59E0B` | **Star ratings** and warnings (amber) |
| `danger` | `#DC2626` | Decline, cancel, earnings-out |

Each has a soft tinted variant for pill/badge backgrounds: `primarySoft`,
`successSoft`, `warningSoft`, `dangerSoft`.

### Semantic surface/text tokens (swap by theme)

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#FFFFFF` | `#0F172A` | Screen background |
| `surface` | `#FFFFFF` | `#1E293B` | Cards, sheets |
| `surfaceMuted` | `#F3F4F6` | `#334155` | Inputs, chips, filled areas |
| `border` | `#E5E7EB` | `#334155` | Hairlines, dividers, input outlines |
| `borderStrong` | `#D1D5DB` | `#475569` | Stronger dividers, empty stars |
| `text` | `#111827` | `#E5E7EB` | Primary text |
| `textMuted` | `#6B7280` | `#9CA3AF` | Secondary / caption text |
| `textInverse` | `#FFFFFF` | `#FFFFFF` | Text on a filled primary button |
| `icon` | `#6B7280` | `#9CA3AF` | Default icon colour |
| `overlay` | `rgba(15,23,42,.45)` | `rgba(0,0,0,.6)` | Dim behind modals/sheets |
| `skeleton` | `#E5E7EB` | `#334155` | Loading placeholders |

> The mockup names ~10 colours; a few extra neutral steps (e.g. `borderStrong`,
> `textMuted`) come from the same grey/slate families because real screens need
> borders and muted text the 10 don't cover. They still live in the one `palette`.

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

**Radius** (`radius.*`): `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 ·
`full` 9999 (pills, avatars, circular buttons).

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
| `Input` | `label`, `error`, `leftIcon`/`rightIcon` | 3 states: default / focused (blue border) / error (red). |
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

## 7. Known state / gotchas

- `npm run typecheck` currently reports pre-existing framework-level errors
  (react-native 0.86 ↔ `@types/react` types) that do **not** affect runtime and are
  unrelated to app code. See the project memory note before acting on them.
