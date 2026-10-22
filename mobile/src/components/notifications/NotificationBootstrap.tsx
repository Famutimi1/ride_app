import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { Notification } from 'expo-notifications';
import { subscribeToNotifications } from '@/services/socket';
import { getNotificationsModule, markNotificationOpened, notificationDestination, notificationFromNative, registerCurrentDevice } from '@/services/notificationService';
import { useNotificationStore } from '@/store/notificationStore';
import { useAuthStore } from '@/store/authStore';
import { notificationAudience } from '@/utils/notificationAudience';

export function NotificationBootstrap() {
  const router = useRouter();
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role);
  const receive = useNotificationStore(state => state.receive);
  const refresh = useNotificationStore(state => state.refresh);
  const refreshPreferences = useNotificationStore(state => state.refreshPreferences);
  const lastOpened = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    useNotificationStore.getState().setContext(userId, role ?? 'rider');
    let active = true;
    const generation = useNotificationStore.getState().generation;
    const sameContext = () => active && useNotificationStore.getState().generation === generation;
    const cleanups: (() => void)[] = [];
    cleanups.push(subscribeToNotifications(value => { if (sameContext()) receive(value); }));
    const register = async () => {
      const store = useNotificationStore.getState();
      if (sameContext() && store.preferences?.pushEnabled && store.permission?.granted) await registerCurrentDevice(false, store.preferences.vibrationEnabled);
    };
    const open = async (notification: Notification) => {
      const value = notificationFromNative(notification);
      if (!sameContext() || !value || lastOpened.current === value.id) return;
      lastOpened.current = value.id;
      try {
        // Authenticate ownership before displaying a possibly old OS notification.
        const updated = await markNotificationOpened(value.id);
        if (!sameContext()) return;
        const audience = notificationAudience(updated);
        if (audience !== 'shared' && audience !== role && !updated.type.startsWith('driver_application_')) {
          if (!await useAuthStore.getState().setRole(audience)) return;
          if (useNotificationStore.getState().generation !== generation + 1) return;
        } else if (!sameContext()) {
          return;
        }
        if (useAuthStore.getState().session?.user.id !== userId) return;
        void refresh().catch(() => undefined);
        router.push(notificationDestination(updated));
      } catch { if (sameContext()) lastOpened.current = null; }
    };
    const initialise = async () => {
      // Read failures must not prevent native notification listeners from being installed.
      await Promise.allSettled([refresh(), refreshPreferences()]);
      if (!sameContext()) return;
      void register().catch(() => undefined);
      if (Platform.OS === 'web') return;
      const notifications = await getNotificationsModule();
      if (!sameContext() || !notifications) return;
      const received = notifications.addNotificationReceivedListener(() => { if (sameContext()) void refresh().catch(() => undefined); });
      const response = notifications.addNotificationResponseReceivedListener(item => { void open(item.notification); });
      const token = notifications.addPushTokenListener(() => { void register().catch(() => undefined); });
      cleanups.push(() => received.remove(), () => response.remove(), () => token.remove());
      const last = notifications.getLastNotificationResponse();
      if (last?.notification) void open(last.notification);
    };
    void initialise().catch(() => undefined);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active' && sameContext()) void Promise.allSettled([refresh(), refreshPreferences()]).then(register).catch(() => undefined);
    });
    cleanups.push(() => appState.remove());
    return () => { active = false; cleanups.forEach(cleanup => cleanup()); };
  }, [receive, refresh, refreshPreferences, role, router, userId]);

  const unreadCount = useNotificationStore(state => state.unreadCount);
  useEffect(() => {
    if (Platform.OS !== 'web') void getNotificationsModule().then(notifications => notifications?.setBadgeCountAsync(unreadCount)).catch(() => undefined);
  }, [unreadCount]);
  return null;
}
