import { Modal, Pressable, View } from 'react-native';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';

interface RideConfirmationModalProps {
  visible: boolean;
  rideName: string;
  fare: number;
  etaMinutes: number;
  paymentName: string;
  pickupAddress: string;
  dropoffAddress: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RideConfirmationModal({ visible, rideName, fare, etaMinutes, paymentName, pickupAddress, dropoffAddress, onClose, onConfirm }: RideConfirmationModalProps) {
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable onPress={onClose} className="flex-1 items-center justify-center px-lg" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}>
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full rounded-[26px] px-lg pb-md pt-lg" style={{ backgroundColor: theme.colors.surface, maxWidth: 430 }}>
        <View className="flex-row items-start justify-between"><View className="flex-1"><Text variant="h3" className="!text-[22px]">Confirm your ride</Text><Text variant="caption" color="textMuted">Review your trip before requesting a driver.</Text></View><View className="ml-md h-10 w-10 items-center justify-center rounded-full bg-primarySoft"><Text variant="bodyMedium" color="primary">✓</Text></View></View>

        <View className="mt-md rounded-xl bg-surfaceMuted p-sm">
          <View className="flex-row items-center"><View className="h-10 w-10 items-center justify-center rounded-lg bg-surface"><Text variant="bodyMedium" className="!text-[23px]">🚘</Text></View><View className="ml-sm flex-1"><Text variant="bodyMedium">{rideName}</Text><Text variant="caption" color="textMuted">Pickup in about {etaMinutes} min</Text></View><Text variant="bodyMedium">₦{fare.toLocaleString()}</Text></View>
        </View>

        <View className="mt-sm rounded-xl border border-border p-sm">
          <LocationSummary icon="●" label="Pickup" address={pickupAddress} color="primary" />
          <View className="ml-[5px] h-5 w-px bg-borderStrong" />
          <LocationSummary icon="■" label="Drop-off" address={dropoffAddress} color="danger" />
        </View>

        <View className="mt-sm flex-row items-center justify-between border-b border-border pb-sm"><View><Text variant="caption" color="textMuted">Payment</Text><Text variant="bodyMedium">{paymentName}</Text></View><View className="rounded-md bg-successSoft px-sm py-xs"><Text variant="caption" color="success">Ready</Text></View></View>
        <View className="mt-sm flex-row items-center gap-sm rounded-lg bg-primarySoft p-sm"><Text color="primary">🛡</Text><Text variant="caption" color="primary" className="flex-1">Your trip and driver location are tracked for safety.</Text></View>

        <View className="mt-md"><Button label={`Confirm ${rideName} · ₦${fare.toLocaleString()}`} size="md" fullWidth onPress={onConfirm} /></View>
        <Pressable onPress={onClose} className="mt-xs items-center py-xs"><Text variant="caption" color="textMuted">Go back and edit</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

function LocationSummary({ icon, label, address, color }: { icon: string; label: string; address: string; color: 'primary' | 'danger' }) {
  return <View className="flex-row items-start gap-md"><Text color={color}>{icon}</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{address}</Text></View></View>;
}
