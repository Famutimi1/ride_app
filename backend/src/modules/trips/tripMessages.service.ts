// Compatibility entry points for existing REST and Socket.IO clients.
// Both transports share the communication module's writer and policy.
export { sendMessage as sendTripMessage } from '../communication/chat.service';
import { messageHistory } from '../communication/chat.service';

export function tripMessages(userId: string,tripId: string,before: unknown) {
  return messageHistory(userId,tripId,{before});
}
