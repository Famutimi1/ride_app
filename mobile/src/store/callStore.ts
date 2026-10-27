import { create } from 'zustand';
import type { CallSnapshot } from '@/services/calling/callTypes';
import type { CallController } from '@/services/calling/CallController';
export const useCallStore=create<CallSnapshot&{controller:CallController|null;backgroundCallsReady:boolean}>(()=>({call:null,busy:false,muted:false,speaker:false,connected:false,error:null,controller:null,backgroundCallsReady:false,playbackBlocked:false}));
