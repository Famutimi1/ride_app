import { apiClient } from '@/lib/apiClient';

export interface SupportSettings {
  phone: string | null;
  email: string | null;
  staffedHours: string;
  availabilityMessage: string;
  version: number;
  updatedAt: string;
}

export const getSupportSettings = () => apiClient.get<SupportSettings>('/care/settings').then((response) => response.data);
