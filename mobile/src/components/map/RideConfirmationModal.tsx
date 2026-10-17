import { Modal, Pressable, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';

interface RideConfirmationModalProps {
  visible: boolean;
  rideName: string;
  fareKobo: number | null;
  paymentName: string;
  pickupAddress: string;
  dropoffAddress: string;
  onClose: () => void;
  onConfirm: () => void;
  scheduledAt?: string;
  loading?: boolean;
}

export function RideConfirmationModal({ visible, rideName, fareKobo, paymentName, pickupAddress, dropoffAddress, onClose, onConfirm, scheduledAt, loading = false }: RideConfirmationModalProps) {
  const theme = useTheme();
  const fareLabel = fareKobo === null ? 'Calculating…' : formatNaira(fareKobo);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!loading) onClose(); }}>
    <Pressable onPress={() => { if (!loading) onClose(); }} className="flex-1 items-center justify-center px-lg" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}>
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full rounded-[14px] px-lg pb-md pt-lg" style={{ backgroundColor: theme.colors.surface, maxWidth: 430 }}>
        <View className="flex-row items-start justify-between"><View className="flex-1"><Text variant="h3" className="!text-[22px]">{scheduledAt ? 'Confirm scheduled ride' : 'Confirm your ride'}</Text><Text variant="caption" color="textMuted">{scheduledAt ? 'Review your trip before scheduling.' : 'Review your trip before requesting a driver.'}</Text></View><View className="ml-md h-10 w-10 items-center justify-center rounded-full bg-primarySoft"><Text variant="bodyMedium" color="primary">✓</Text></View></View>

        <View className="mt-md rounded-xl bg-surfaceMuted p-sm">
          <View className="flex-row items-center"><View className="h-10 w-10 items-center justify-center rounded-lg bg-surface"><Text variant="bodyMedium" className="!text-[23px]">🚘</Text></View><View className="ml-sm flex-1"><Text variant="bodyMedium">{rideName}</Text><Text variant="caption" color="textMuted">{scheduledAt ? new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt)) : 'Driver matched after request'}</Text></View><Text variant="bodyMedium">{fareLabel}</Text></View>
        </View>

        <View className="mt-sm rounded-xl border border-border p-sm">
          <LocationSummary icon="●" label="Pickup" address={pickupAddress} color="primary" />
          <View className="ml-[5px] h-5 w-px bg-borderStrong" />
          <LocationSummary icon="■" label="Drop-off" address={dropoffAddress} color="danger" />
        </View>

        <View className="mt-sm flex-row items-center justify-between border-b border-border pb-sm"><View><Text variant="caption" color="textMuted">Payment</Text><Text variant="bodyMedium">{paymentName}</Text></View><View className="rounded-md bg-successSoft px-sm py-xs"><Text variant="caption" color="success">Ready</Text></View></View>
        <View className="mt-sm flex-row items-center gap-sm rounded-lg bg-primarySoft p-sm"><Text color="primary">🛡</Text><Text variant="caption" color="primary" className="flex-1">Your trip and driver location are tracked for safety.</Text></View>

        {scheduledAt ? <Text variant="caption" color="textMuted" className="mt-sm">We start searching about 5 minutes before pickup. Your booking does not guarantee a driver.</Text> : null}
        <View className="mt-md"><Button label={`${scheduledAt ? 'Schedule' : 'Confirm'} ${rideName} · ${fareLabel}`} size="md" fullWidth loading={loading} disabled={fareKobo === null || loading} onPress={onConfirm} /></View>
        <Pressable onPress={onClose} disabled={loading} className="mt-xs items-center py-xs"><Text variant="caption" color="textMuted">Go back and edit</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

function LocationSummary({ icon, label, address, color }: { icon: string; label: string; address: string; color: 'primary' | 'danger' }) {
  return <View className="flex-row items-start gap-md"><Text color={color}>{icon}</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{address}</Text></View></View>;
}
