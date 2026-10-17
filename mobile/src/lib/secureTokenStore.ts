import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS='rakkyAccessToken', REFRESH='rakkyRefreshToken';
const webStore = typeof sessionStorage === 'undefined' ? null : sessionStorage;
const set=(key:string,value:string)=>Platform.OS==='web'?Promise.resolve(webStore?.setItem(key,value)):SecureStore.setItemAsync(key,value);
const get=(key:string)=>Platform.OS==='web'?Promise.resolve(webStore?.getItem(key)??null):SecureStore.getItemAsync(key);
const remove=(key:string)=>Platform.OS==='web'?Promise.resolve(webStore?.removeItem(key)):SecureStore.deleteItemAsync(key);
let pendingWrite: Promise<unknown> = Promise.resolve();
let sessionGeneration = 0;
function write<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(operation);
  pendingWrite = result.catch(() => undefined);
  return result;
}
export const tokenStore={
  setTokens(tokens:{accessToken:string;refreshToken:string}, expectedRefreshToken?: string) {
    if (expectedRefreshToken === undefined) sessionGeneration++;
    return write(async () => {
      if (expectedRefreshToken !== undefined && await get(REFRESH) !== expectedRefreshToken) return false;
      await Promise.all([set(ACCESS,tokens.accessToken),set(REFRESH,tokens.refreshToken)]);
      return true;
    });
  },
  getAccessToken:async()=>{await pendingWrite;return get(ACCESS);},
  getRefreshToken:async()=>{await pendingWrite;return get(REFRESH);},
  getSessionGeneration:()=>sessionGeneration,
  clear:()=>{sessionGeneration++;return write(async()=>{await Promise.all([remove(ACCESS),remove(REFRESH)]);});},
};
