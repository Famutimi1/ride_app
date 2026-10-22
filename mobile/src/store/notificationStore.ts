import { create } from 'zustand';
import type { AppNotification, NotificationPermissionState, NotificationPreferences } from '@/services/notificationService';
import { getNotificationPermission, getNotificationPreferences, getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationOpened, markNotificationRead, updateNotificationPreferences } from '@/services/notificationService';
import { notificationBelongsToRole, type NotificationRole } from '@/utils/notificationAudience';

interface NotificationState {
  userId: string | null; role: NotificationRole; generation: number;
  items: AppNotification[]; current: AppNotification | null; pending: AppNotification[];
  unreadCount: number; nextCursor: string | null; loading: boolean;
  preferences: NotificationPreferences | null; permission: NotificationPermissionState | null; recentIds: string[];
  setContext: (userId: string | null, role: NotificationRole) => void;
  receive: (notification: AppNotification) => void; dismiss: () => void;
  refresh: () => Promise<void>; loadMore: () => Promise<void>;
  refreshPreferences: () => Promise<void>; savePreferences: (input: Partial<NotificationPreferences>) => Promise<void>;
  markRead: (id: string) => Promise<void>; markOpened: (id: string) => Promise<void>; markAllRead: () => Promise<void>; reset: () => void;
}

function merge(items: AppNotification[], incoming: AppNotification[]) {
  const values = new Map(items.map(item => [item.id, item]));
  for (const item of incoming) values.set(item.id, item);
  return [...values.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const emptyInbox = () => ({ items: [] as AppNotification[], current: null, pending: [] as AppNotification[], unreadCount: 0, nextCursor: null, loading: false, recentIds: [] as string[] });

export const useNotificationStore = create<NotificationState>((set, get) => {
  let request = 0;
  let revision = 0;
  let refreshJob: { generation: number; promise: Promise<void> } | null = null;
  const belongs = (item: AppNotification) => {
    const { userId, role } = get();
    return Boolean(userId && (!item.userId || item.userId === userId) && notificationBelongsToRole(item, role));
  };
  const mark = async (id: string, opened: boolean) => {
    const { generation, userId, role } = get();
    if (!userId) throw new Error('Sign in to open notifications.');
    const updated = await (opened ? markNotificationOpened(id, role) : markNotificationRead(id, role));
    if (get().generation !== generation) throw new Error('Your notification mode changed. Please try again.');
    if (!belongs(updated)) throw new Error('This notification belongs to another mode.');
    revision += 1;
    set(state => ({ items: merge(state.items, [updated]), unreadCount: Math.max(0, state.unreadCount - (state.items.some(item => item.id === id && !item.readAt) ? 1 : 0)) }));
  };
  return {
    userId: null, role: 'rider', generation: 0, ...emptyInbox(), preferences: null, permission: null,
    setContext: (userId, role) => {
      const previous = get();
      if (previous.userId === userId && previous.role === role) return;
      request += 1; revision += 1; refreshJob = null;
      set({ userId, role, generation: previous.generation + 1, ...emptyInbox(), ...(previous.userId !== userId ? { preferences: null, permission: null } : {}) });
    },
    receive: notification => {
      if (!belongs(notification)) return;
      const state = get();
      if (state.recentIds.includes(notification.id) || state.items.some(item => item.id === notification.id)) return;
      revision += 1;
      const silent = notification.type === 'ride_offer' || notification.type === 'offer_expired';
      set({ recentIds: [notification.id, ...state.recentIds].slice(0, 100), items: merge(state.items, [notification]), unreadCount: state.unreadCount + (notification.readAt ? 0 : 1), ...(silent ? {} : state.current ? { pending: [...state.pending, notification] } : { current: notification }) });
    },
    dismiss: () => set(state => ({ current: state.pending[0] ?? null, pending: state.pending.slice(1) })),
    refresh: () => {
      const { generation, role, userId } = get();
      if (!userId) return Promise.resolve();
      if (refreshJob?.generation === generation) return refreshJob.promise;
      const key = ++request;
      set({ loading: true });
      const promise = (async () => {
        try {
          // A socket event/read during this fetch requires a new snapshot, never an older overwrite.
          let before: number;
          do {
            before = revision;
            const [data, count] = await Promise.all([getNotifications(undefined, role), getUnreadNotificationCount(role)]);
            if (get().generation !== generation || key !== request) return;
            if (before === revision) set({ items: data.notifications.filter(belongs), nextCursor: data.nextCursor, unreadCount: count });
          } while (before !== revision);
        } finally {
          if (get().generation === generation && key === request) set({ loading: false });
          if (refreshJob?.generation === generation) refreshJob = null;
        }
      })();
      refreshJob = { generation, promise };
      return promise;
    },
    loadMore: async () => {
      const { generation, role, nextCursor: cursor, loading, userId } = get();
      if (!userId || !cursor || loading) return;
      const key = ++request;
      const before = revision;
      set({ loading: true });
      try {
        const data = await getNotifications(cursor, role);
        if (get().generation !== generation || key !== request) return;
        // Local read state wins if a read completed while this page was in flight.
        set(state => ({ items: before === revision ? merge(state.items, data.notifications.filter(belongs)) : merge(data.notifications.filter(belongs), state.items), nextCursor: data.nextCursor === cursor ? null : data.nextCursor }));
      } finally { if (get().generation === generation && key === request) set({ loading: false }); }
    },
    refreshPreferences: async () => {
      const { generation, userId } = get(); if (!userId) return;
      const [preferences, permission] = await Promise.all([getNotificationPreferences(), getNotificationPermission()]);
      if (get().generation === generation) set({ preferences, permission });
    },
    savePreferences: async input => {
      const { generation, userId } = get(); if (!userId) return;
      const preferences = await updateNotificationPreferences(input);
      if (get().generation === generation) set({ preferences });
    },
    markRead: id => mark(id, false), markOpened: id => mark(id, true),
    markAllRead: async () => {
      const { generation, role, userId } = get(); if (!userId) return;
      await markAllNotificationsRead(role);
      if (get().generation !== generation) return;
      // Reconcile so notifications arriving during Read all remain unread if the server did not mark them.
      revision += 1;
      await get().refresh();
    },
    reset: () => {
      request += 1; revision += 1; refreshJob = null;
      set(state => ({ userId: null, role: 'rider', generation: state.generation + 1, ...emptyInbox(), preferences: null, permission: null }));
    },
  };
});
