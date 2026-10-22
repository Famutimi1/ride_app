import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Avatar, Button, Text } from '@/components/common';
import { AddressIcon } from '@/components/map/AddressIcon';
import { radius, spacing, useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import type { PickedAvatar } from '@/services/authService';
export function ProfilePhotoEditor({ locked }: {
    locked: boolean;
}) {
    const { colors } = useTheme();
    const user = useAuthStore(state => state.session?.user);
    const [selected, setSelected] = useState<PickedAvatar | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const choose = async () => {
        if (inFlight.current || locked || !user)
            return;
        const id = user.id;
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], multiple: false, copyToCacheDirectory: true });
            if (result.canceled || useAuthStore.getState().session?.user.id !== id)
                return;
            const file = result.assets[0];
            if (file.size && file.size > 5 * 1024 * 1024) {
                setError('Choose a photo smaller than 5 MB.');
                return;
            }
            setSelected(file);
            setError(null);
        }
        catch {
            setError('Could not open your files. Please try again.');
        }
    };
    const save = async (remove = false) => {
        if (inFlight.current || locked || !user)
            return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            await useAuthStore.getState().updateAvatar(remove ? null : selected);
            setSelected(null);
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not update your photo.');
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const actionLabel = selected ? 'Choose another' : 'Change photo';
    return <View style={styles.container}>
    <View style={styles.summary}>
      <Pressable accessibilityRole="button" accessibilityLabel="Change profile picture"
        accessibilityHint={locked ? 'Finish your trip before changing your photo' : 'Choose a new profile photo from your files'}
        accessibilityState={{ disabled: busy || locked }} disabled={busy || locked} onPress={() => void choose()} style={styles.avatarButton}>
        <Avatar uri={user?.avatarUrl} name={user?.name} size="lg" />
        <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}><AddressIcon name="edit" size={13} color="textInverse" /></View>
      </Pressable>
      <View style={styles.copy}><Text variant="bodyMedium">{user?.name ?? 'Your account'}</Text><Text variant="caption" color="textMuted">{user?.role === 'driver' ? 'Driver' : 'Rider'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} accessibilityState={{ disabled: busy || locked }} disabled={busy || locked} onPress={() => void choose()}
        style={[styles.photoAction, { backgroundColor: colors.primarySoft }]}><Text variant="caption" color="primary">{actionLabel}</Text></Pressable>
    </View>
    {locked ? <Text variant="caption" color="textMuted">Finish your trip before changing your photo.</Text> : <>
    {selected ? <View style={styles.preview}><Avatar uri={selected.uri} name={user?.name} size="lg"/><Text variant="caption" color="textMuted">New photo · ready to save</Text></View> : null}
    {selected || user?.avatarUrl ? <View style={styles.actions}>
      {selected ? <><Button label="Save photo" size="sm" loading={busy} onPress={() => void save()}/><Pressable accessibilityRole="button" disabled={busy} onPress={() => setSelected(null)} style={styles.link}><Text variant="caption" color="textMuted">Cancel</Text></Pressable></> : user?.avatarUrl ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(true)} style={styles.link}><Text variant="caption" color="danger">{busy ? 'Removing…' : 'Remove photo'}</Text></Pressable> : null}
    </View> : null}
    <Text variant="caption" color="textMuted">JPG, PNG or WebP · up to 5 MB. Profile photos are visible to others.</Text>
    {error ? <Text variant="caption" color="danger" accessibilityRole="alert">{error}</Text> : null}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  avatarButton: { width: 60, height: 60, justifyContent: 'center' },
  editBadge: { position: 'absolute', right: 0, bottom: 0, width: 24, height: 24, borderRadius: radius.full, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  photoAction: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.full },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  link: { minHeight: 44, justifyContent: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
