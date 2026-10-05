import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS='rakkyAccessToken', REFRESH='rakkyRefreshToken';
const webStore = typeof sessionStorage === 'undefined' ? null : sessionStorage;
const set=(key:string,value:string)=>Platform.OS==='web'?Promise.resolve(webStore?.setItem(key,value)):SecureStore.setItemAsync(key,value);
const get=(key:string)=>Platform.OS==='web'?Promise.resolve(webStore?.getItem(key)??null):SecureStore.getItemAsync(key);
const remove=(key:string)=>Platform.OS==='web'?Promise.resolve(webStore?.removeItem(key)):SecureStore.deleteItemAsync(key);
export const tokenStore={
  async setTokens(tokens:{accessToken:string;refreshToken:string}){await Promise.all([set(ACCESS,tokens.accessToken),set(REFRESH,tokens.refreshToken)]);},
  getAccessToken:()=>get(ACCESS), getRefreshToken:()=>get(REFRESH),
  async clear(){await Promise.all([remove(ACCESS),remove(REFRESH)]);},
};
