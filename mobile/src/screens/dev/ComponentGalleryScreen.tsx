/**
 * ComponentGalleryScreen — a design-system reference (route: "/gallery").
 *
 * This used to be the app's entry screen; now that the auth flow is the real entry,
 * it lives here as a dev-only page for eyeballing every base component and checking
 * light/dark theming. It isn't linked from anywhere — reach it by navigating to
 * "/gallery". Flip your device between light and dark to watch tokens swap.
 */
import { cssInterop } from 'nativewind';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Avatar,
  Button,
  Card,
  Input,
  RatingStars,
  Skeleton,
  StatusPill,
  Text,
} from '@/components/common';
import { useTheme } from '@/constants/theme';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

export function ComponentGalleryScreen() {
  const theme = useTheme();
  const [rating, setRating] = useState(4);

  return (
    <StyledSafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-xl p-xl">
        <View className="gap-xs">
          <Text variant="h2">Design System</Text>
          <Text variant="body" color="textMuted">
            Live preview · {theme.scheme} mode
          </Text>
        </View>

        {/* Typography scale */}
        <Section title="Typography">
          <Text variant="h1">Heading 1</Text>
          <Text variant="h2">Heading 2</Text>
          <Text variant="h3">Heading 3</Text>
          <Text variant="body">Body — the quick brown fox jumps over it.</Text>
          <Text variant="bodyMedium">Body medium — a touch heavier.</Text>
          <Text variant="caption" color="textMuted">Caption · secondary text</Text>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <Button label="Primary" onPress={() => {}} fullWidth />
          <Button label="Secondary" variant="secondary" onPress={() => {}} fullWidth />
          <Button label="Ghost" variant="ghost" onPress={() => {}} fullWidth />
          <Button label="Destructive" variant="destructive" onPress={() => {}} fullWidth />
          <Button label="Loading" loading fullWidth />
          <Button label="Disabled" disabled fullWidth />
        </Section>

        {/* Inputs */}
        <Section title="Inputs">
          <Input label="Default" placeholder="Enter your name" />
          <Input label="With error" placeholder="you@example.com" error="That email looks off" />
        </Section>

        {/* Status pills */}
        <Section title="Status pills">
          <View className="flex-row flex-wrap items-center gap-sm">
            <StatusPill tone="success" label="Online" dot />
            <StatusPill tone="primary" label="In progress" />
            <StatusPill tone="warning" label="Searching…" />
            <StatusPill tone="danger" label="Cancelled" />
            <StatusPill tone="neutral" label="Draft" />
          </View>
        </Section>

        {/* Avatars + rating */}
        <Section title="Avatars & rating">
          <View className="flex-row flex-wrap items-center gap-sm">
            <Avatar name="Chidi Okeke" size="lg" />
            <Avatar name="Ada Nwosu" size="md" />
            <Avatar name="Bola" size="sm" />
          </View>
          <RatingStars value={rating} interactive onChange={setRating} />
          <Text variant="caption" color="textMuted">Tap the stars — value: {rating}</Text>
        </Section>

        {/* Card + skeletons */}
        <Section title="Card & skeletons">
          <Card elevation="md" padding="lg" className="gap-sm">
            <Text variant="bodyMedium">Fare estimate</Text>
            <Text variant="h3">₦3,450</Text>
            <Text variant="caption" color="textMuted">Est. 12 min · 6.4 km</Text>
          </Card>
          <Card elevation="sm" padding="lg" className="gap-sm">
            <Skeleton width="60%" height={20} />
            <Skeleton width="90%" height={14} />
            <Skeleton width="40%" height={14} />
          </Card>
        </Section>
      </ScrollView>
    </StyledSafeAreaView>
  );
}

/** Small labelled group used only in this gallery. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-md">
      <Text variant="caption" color="textMuted" className="tracking-[1px]">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}
