import configPlugins from 'expo/config-plugins.js';
import type { ConfigPlugin } from 'expo/config-plugins';
const {AndroidConfig,withAndroidManifest,withInfoPlist}=configPlugins;
interface NativeCallsOptions {enabled:boolean;apnsEnvironment:'development'|'production';}
const withNativeCalls:ConfigPlugin<NativeCallsOptions>=(config,{enabled,apnsEnvironment})=>{
  config.ios??={};config.ios.entitlements??={};
  config.android??={};
  config.android.blockedPermissions=[...new Set([...(config.android.blockedPermissions??[]),'android.permission.CALL_PHONE','android.permission.READ_PHONE_STATE','android.permission.READ_PHONE_NUMBERS'])];
  if(enabled)config.ios.entitlements['aps-environment']=apnsEnvironment;
  config=withInfoPlist(config,value=>{
    value.modResults.RakkyNativeCallsEnabled=enabled;
    if(enabled)value.modResults.UIBackgroundModes=[...new Set([...(value.modResults.UIBackgroundModes??[]),'audio','voip','remote-notification'])];
    return value;
  });
  config=withAndroidManifest(config,value=>{
    const application=AndroidConfig.Manifest.getMainApplicationOrThrow(value.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application,'com.rackyride.NATIVE_CALLS_ENABLED',String(enabled),'value');
    return value;
  });
  return config;
};
export default withNativeCalls;
