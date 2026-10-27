import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '@/lib/apiClient';
import { tokenStore } from '@/lib/secureTokenStore';

export interface TripMessage {
  id: string;
  recordId: string;
  tripId: string;
  senderId: string;
  senderRole: 'rider' | 'driver';
  text: string;
  sequence: string;
  sentAt: number;
}
export interface ChatReceipts {
  tripId: string;
  version: string;
  rider: { deliveredSequence: string; readSequence: string };
  driver: { deliveredSequence: string; readSequence: string };
}
export interface TripCommunication {
  tripId: string;
  status: 'open' | 'closed' | 'unavailable';
  participant: { id: string; name: string } | null;
  participantRole: 'rider' | 'driver';
  canRead: boolean;
  canMessage: boolean;
  canAudioCall: boolean;
  audioConnectionMode?: 'disabled'|'direct-only'|'direct-and-relay';
  canVideoCall: boolean;
  videoUnavailableReason?:string|null;
  videoValidUntil?:number;
  maxMessageLength: number;
  highWaterSequence: string;
  receipts: ChatReceipts | null;
  unavailableReason: string | null;
}
export interface MessagePage {
  messages: TripMessage[];
  nextBefore: string | null;
  nextAfter: string | null;
  highWaterSequence: string;
  receipts: ChatReceipts | null;
}
// Capture the account generation when the action starts, rather than letting a
// delayed interceptor attach a newly signed-in account's token to old work.
function config(params?: Record<string,string>): AxiosRequestConfig & { _sessionGeneration: number } {
  return {_sessionGeneration:tokenStore.getSessionGeneration(),params};
}
export async function getTripCommunication(tripId: string) {
  return (await apiClient.get<TripCommunication>(`/trips/${tripId}/communication`,config())).data;
}
export async function getTripMessages(tripId: string,params: Record<string,string> = {}) {
  return (await apiClient.get<MessagePage>(`/trips/${tripId}/messages`,config(params))).data;
}
export async function persistTripMessage(tripId: string,input: {id:string;text:string}) {
  return (await apiClient.post<{message:TripMessage;created:boolean}>(`/trips/${tripId}/messages`,input,config())).data.message;
}
export async function updateChatReceipt(tripId: string,kind: 'delivered' | 'read',sequence: string) {
  return (await apiClient.post<ChatReceipts>(`/trips/${tripId}/communication/receipts`,{kind,sequence},config())).data;
}
