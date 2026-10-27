import { create } from 'zustand';
import { safeMessage } from '@/utils/userMessage';
import type { MessageTone } from '@/components/common/AppMessage';

export interface ToastMessage { id: number; message: string; tone: MessageTone }
export interface ConfirmationOptions { title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
export interface ConfirmationMessage extends ConfirmationOptions { id: number }
interface FeedbackState { toast: ToastMessage | null; dialog: ConfirmationMessage | null }
export const useFeedbackStore = create<FeedbackState>(() => ({ toast: null, dialog: null }));
let nextId = 0;
let settle: ((confirmed: boolean) => void) | undefined;

export function closeConfirmation(confirmed: boolean) {
  const resolve = settle;
  settle = undefined;
  useFeedbackStore.setState({ dialog: null });
  resolve?.(confirmed);
}
export function dismissToast(id: number) {
  if (useFeedbackStore.getState().toast?.id === id) useFeedbackStore.setState({ toast: null });
}
export function clearFeedback() {
  closeConfirmation(false);
  useFeedbackStore.setState({ toast: null });
}
export const feedback = {
  show(message: string, tone: MessageTone = 'info') {
    useFeedbackStore.setState({ toast: { id: ++nextId, message: safeMessage(message), tone } });
  },
  success(message: string) { feedback.show(message, 'success'); },
  error(message: string) { feedback.show(message, 'error'); },
  confirm(options: ConfirmationOptions): Promise<boolean> {
    // Ignore duplicate taps while another decision is open. Never replace its resolver.
    if (useFeedbackStore.getState().dialog) return Promise.resolve(false);
    return new Promise(resolve => {
      settle = resolve;
      useFeedbackStore.setState({ dialog: { ...options, message: safeMessage(options.message), id: ++nextId } });
    });
  },
  alert(title: string, message: string) { void feedback.confirm({ title, message, confirmLabel: 'Got it' }); },
};
