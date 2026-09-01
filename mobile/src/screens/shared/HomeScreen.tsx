/**
 * HomeScreen — the rider's landing screen after signing in (route: "/home").
 *
 * Rebuilt to match the "Rider Home" design mockup: a full-bleed map with floating
 * controls on top (theme toggle · "where to" search · recentre), and a docked
 * card of recent destinations ending in a "Set Pickup" call-to-action.
 *
 * Honest placeholders for now (nothing here is silently faked):
 *   • The map is <MapPlaceholder> — a real map needs a native maps library we
 *     haven't added yet (a major dependency to flag first, AGENTS.md §10).
 *   • Search / recentre / Set Pickup are stubs — the rider booking flow
 *     (SetDestination → ConfirmRide → …) is the next build step.
 *   • The recent destinations are hard-coded sample data (no trips module yet).
 *
 * TEMPORARY: the role switch + "Log out" strip at the bottom of the card belongs
 * on the shared ProfileScreen (see docs/architecture/structure.md). It lives here
 * only so you can still switch role / sign out until that screen exists.
 */
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Text, ThemeToggle } from '@/components/common';
import { MapPlaceholder } from '@/components/map';
import { useTheme } from '@/constants/theme';
import { type UserRole } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

// The rider's saved / recent destinations shown in the mockup. Hard-coded for
// now; a real list will come from the trips module once it exists.
const RECENT_DESTINATIONS = [
  { id: 'home', icon: '🏠', label: 'Home', address: '12, Road 12, Staten.', price: '$12.10' },
  { id: 'work', icon: '🏢', label: 'Work', address: '32, Park Avenue.', price: '$0.40' },
] as const;

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'rider', label: 'Rider' },
  { value: 'driver', label: 'Driver' },
  { value: 'both', label: 'Both' },
];

export function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.session?.user);
  const setRole = useAuthStore((s) => s.setRole);
  const logout = useAuthStore((s) => s.logout);

  // The router only shows this screen when signed in, but guard anyway for types.
  if (!user) return null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* ── Map region: fills all the space above the docked card ─────────── */}
      <View style={{ flex: 1 }}>
        <MapPlaceholder>
          {/* ETA pill, centred over the map like the mockup's "3 min". */}
          <View style={{ position: 'absolute', top: '58%', left: 0, right: 0, alignItems: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                backgroundColor: theme.colors.primary,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                borderRadius: theme.radius.full,
                ...theme.elevation.md,
              }}
            >
              <Text variant="button" color="textInverse">
                🕐
              </Text>
              <Text variant="button" color="textInverse">
                3 min
              </Text>
            </View>
          </View>
        </MapPlaceholder>

        {/* ── Floating top bar: theme toggle · search · recentre ──────────── */}
        <View
          style={{
            position: 'absolute',
            top: insets.top + theme.spacing.sm,
            left: theme.spacing.lg,
            right: theme.spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          {/* Mockup's top-left is a round button; we use it for the light/dark
              toggle (a real "back" would be a dead control on the root screen). */}
          <ThemeToggle floating />

          {/* "where to" search — a tap target for now; the search screen is next. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for a destination"
            onPress={() => {
              /* TODO: open the destination search screen (rider flow) */
            }}
            style={({ pressed }) => ({
              flex: 1,
              height: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.surface,
              opacity: pressed ? 0.85 : 1,
              ...theme.elevation.sm,
            })}
          >
            <Text variant="body" color="textMuted">
              🔍
            </Text>
            <Text variant="body" color="textMuted">
              where to
            </Text>
          </Pressable>

          {/* Recentre-on-me button — stub until the real map lands. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Center on my location"
            hitSlop={8}
            onPress={() => {
              /* TODO: recentre the map on the rider's GPS position */
            }}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: theme.radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surface,
              opacity: pressed ? 0.6 : 1,
              ...theme.elevation.sm,
            })}
          >
            <Text variant="bodyMedium">◎</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Docked bottom card: recent destinations + Set Pickup ──────────── */}
      <Card
        elevation="lg"
        padding="lg"
        style={{
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingBottom: insets.bottom + theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        {RECENT_DESTINATIONS.map((item, index) => (
          <View key={item.id}>
            {/* Hairline divider between rows (not before the first one). */}
            {index > 0 && <View style={{ height: 1, backgroundColor: theme.colors.border }} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Set pickup to ${item.label}`}
              onPress={() => {
                /* TODO: prefill this destination into the booking flow */
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {/* Icon tile (the mockup shows a photo for Home, an icon for Work;
                  we use a themed emoji tile for both until we have real data). */}
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.surfaceMuted,
                }}
              >
                <Text variant="h3">{item.icon}</Text>
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyMedium">{item.label}</Text>
                <Text variant="caption" color="textMuted">
                  {item.address}
                </Text>
              </View>

              <Text variant="bodyMedium">{item.price}</Text>
            </Pressable>
          </View>
        ))}

        <Button
          label="Set Pickup"
          fullWidth
          onPress={() => {
            /* TODO: start the booking flow (SetDestination → ConfirmRide → …) */
          }}
        />

        {/* ── TEMPORARY account controls ─────────────────────────────────────
            These belong on the shared ProfileScreen (docs/architecture). Kept
            here so you can still switch role / log out until that screen exists;
            remove this whole block once ProfileScreen lands. */}
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginTop: theme.spacing.xs }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.md,
              padding: 4,
              gap: 4,
            }}
          >
            {ROLE_OPTIONS.map((option) => {
              const selected = user.role === option.value;
              return (
                <Text
                  key={option.value}
                  onPress={() => setRole(option.value)}
                  variant="caption"
                  color={selected ? 'text' : 'textMuted'}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.sm,
                    backgroundColor: selected ? theme.colors.surface : 'transparent',
                  }}
                >
                  {option.label}
                </Text>
              );
            })}
          </View>
          <Button label="Log out" variant="ghost" size="sm" onPress={logout} />
        </View>
      </Card>
    </View>
  );
}
