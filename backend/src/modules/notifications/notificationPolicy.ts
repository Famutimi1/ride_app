import type {NotificationCategory} from './notifications.types';

export interface DeliveryPreferences {
  category:NotificationCategory;push_enabled:boolean;trip_updates_enabled:boolean;driver_offers_enabled:boolean;
  scheduled_reminders_enabled:boolean;wallet_updates_enabled:boolean;promotions_enabled:boolean;sound_enabled:boolean;vibration_enabled:boolean;
}

export function notificationCategoryEnabled(row:DeliveryPreferences){
  if(row.category==='safety_security'||row.category==='support')return row.push_enabled;
  if(!row.push_enabled)return false;
  if(row.category==='trip_updates')return row.trip_updates_enabled;
  if(row.category==='driver_offers')return row.driver_offers_enabled;
  if(row.category==='scheduled_reminders')return row.scheduled_reminders_enabled;
  if(row.category==='wallet_updates')return row.wallet_updates_enabled;
  return row.promotions_enabled;
}

