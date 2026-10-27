import { UserFacingError } from '@/utils/userMessage';
import { apiClient } from '@/lib/apiClient';
import { isAxiosError,type AxiosRequestConfig } from 'axios';
import type { CallApi } from './callTypes';

// Every action stays bound to the account that mounted the controller.
export function callApiForGeneration(generation:number):CallApi {
  const config:AxiosRequestConfig&{_sessionGeneration:number}={_sessionGeneration:generation};
  const messages:Record<string,string>={
    call_participant_busy:'One of you is already on a call. Please try again shortly.',
    audio_calling_unavailable:'Audio calling is not available right now. You can send a trip message.',
    trip_calling_unavailable:'Calls are available only during an assigned, active trip.',
    call_owned_by_other_device:'This call was answered on another device.',
    call_expired:'This call has expired. Please start a new call.',
    call_rate_limited:'Please wait a moment before trying another call.',
    call_not_found:'This call is no longer available.',
    call_version_conflict:'The call changed. Please try again.',
    video_disabled:'Video calling is not enabled yet. You can use audio calling.',
    video_before_trip_only:'Video is available only before the trip starts.',
    driver_location_unavailable:'Video needs a fresh driver location. Audio calling is still available.',
    driver_location_stale:'The driver location is too old for video. Try audio calling.',
    driver_must_be_stationary:'The driver must be stationary before you can use video.',
    video_upgrade_pending:'A video request is already waiting for a response.',
    video_upgrade_expired:'The video request expired. You can try again.',
    video_upgrade_peer_consent_required:'Wait for the other participant to accept video.',
    video_client_update_required:'Update the app to answer with video, or answer with audio.',
  };
  const friendly=async<T>(work:()=>Promise<T>)=>{
    try{return await work();}catch(error){
      if(!isAxiosError(error))throw error;
      const code=(error.response?.data as {error?:string}|undefined)?.error;
      throw new UserFacingError(code&&messages[code]||'Unable to connect your call. Check your internet connection and try again.');
    }
  };
  const get=<T>(path:string)=>friendly(async()=>(await apiClient.get<T>(path,config)).data);
  const post=<T>(path:string,body:unknown)=>friendly(async()=>(await apiClient.post<T>(path,body,config)).data);
  return {
    active:()=>get('/calls/active'),get:id=>get(`/calls/${id}`),
    start:(tripId,requestId,media='audio')=>post(`/trips/${tripId}/calls`,{requestId,media,protocol:2}),
    command:(id,action,version)=>post(`/calls/${id}/${action}`,{version,protocol:2}),
    lease:(id,generation,connected)=>post(`/calls/${id}/lease`,{generation,connected}),
    turn:id=>post(`/calls/${id}/turn-credentials`,{}),
  };
}
