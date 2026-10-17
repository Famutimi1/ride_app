import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { notificationDestination, type AppNotification } from '@/services/notificationService';

export function NotificationBanner({ notification, onDismiss, onOpen }: {
  notification: AppNotification;
  onDismiss: () => void;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const open = () => {
    onOpen(notification.id);
    onDismiss();
    router.push(notificationDestination(notification));
  };

  return (
    <SafeAreaView edges={['top']} pointerEvents="box-none" className="absolute left-md right-md top-0 z-50">
      <View
        accessibilityLiveRegion="assertive"
        className={`flex-row items-start rounded-xl border bg-surface p-md ${notification.priority === 'high' ? 'border-warning' : 'border-border'}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${notification.title}. ${notification.body}`}
          onPress={open}
          className="flex-1 flex-row items-start"
        >
          <View className={`mr-md h-10 w-10 items-center justify-center rounded-lg ${notification.priority === 'high' ? 'bg-warningSoft' : 'bg-primarySoft'}`}>
            <Text color={notification.priority === 'high' ? 'warning' : 'primary'}>{notification.priority === 'high' ? '!' : '●'}</Text>
          </View>
          <View className="flex-1">
            <Text variant="bodyMedium">{notification.title}</Text>
            <Text variant="caption" color="textMuted" className="mt-xs">{notification.body}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={10}
          onPress={onDismiss}
          className="ml-sm px-xs"
        >
          <Text color="textMuted">×</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
