import { create } from 'zustand';

export interface CourierDraft {
  description: string;
  weightKg: number;
  recipientName: string;
  recipientPhone: string;
  pickupInstructions: string;
  dropoffInstructions: string;
  acceptedRestrictions: boolean;
}

interface CourierDraftState {
  draft: CourierDraft | null;
  setDraft: (draft: CourierDraft) => void;
  clearDraft: () => void;
}

export const useCourierDraftStore = create<CourierDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));
