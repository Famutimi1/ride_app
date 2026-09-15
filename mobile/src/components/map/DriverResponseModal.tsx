import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';

interface DriverResponseModalProps {
  visible: boolean;
  rideName: string;
  fare: number;
  onCancel: () => void;
}

/** Waiting state shown after a rider confirms. Socket trip events can replace
 * this state with accepted/declined screens when trip matching is connected. */
export function DriverResponseModal({ visible, rideName, fare, onCancel }: DriverResponseModalProps) {
  const theme = useTheme();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}>
      <View className="w-full items-center rounded-[28px] px-xl pb-lg pt-xl" style={{ backgroundColor: theme.colors.surface, maxWidth: 410 }}>
        <View className="h-20 w-20 items-center justify-center rounded-full bg-primarySoft">
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
        <Text variant="h3" className="mt-lg !text-[23px]">Waiting for driver</Text>
        <Text variant="caption" color="textMuted" className="mt-xs text-center">Your ride request has been sent to the nearest verified driver.</Text>

        <View className="mt-lg w-full rounded-2xl bg-surfaceMuted p-md">
          <View className="flex-row items-center"><View className="h-12 w-12 items-center justify-center rounded-xl bg-surface"><Text variant="h3" className="!text-[25px]">🚘</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{rideName}</Text><Text variant="caption" color="textMuted">Request sent · awaiting response</Text></View><Text variant="bodyMedium">₦{fare.toLocaleString()}</Text></View>
        </View>

        <View className="mt-md w-full flex-row items-center gap-sm rounded-xl bg-successSoft p-md"><View className="h-2 w-2 rounded-full bg-success" /><Text variant="caption" color="success" className="flex-1">Driver is reviewing your pickup and fare</Text></View>
        <Text variant="caption" color="textMuted" className="mt-md text-center">This normally takes less than a minute. We’ll notify you as soon as the driver accepts or declines.</Text>
        <Pressable accessibilityRole="button" onPress={onCancel} className="mt-lg w-full items-center rounded-lg border border-borderStrong py-md"><Text variant="bodyMedium" color="danger">Cancel request</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
