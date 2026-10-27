import { useEffect,useState } from 'react';
import { NativeModules,View } from 'react-native';
import type { VideoStream } from '@/services/calling/callTypes';

export function CallVideo({stream,mirror=false,preview=false}:{stream:VideoStream;mirror?:boolean;preview?:boolean}) {
  const [renderer,setRenderer]=useState<{View:typeof import('react-native-webrtc').RTCView}|null>(null);
  useEffect(()=>{
    let live=true;
    if(NativeModules.WebRTCModule)void import('react-native-webrtc').then(module=>{if(live)setRenderer({View:module.RTCView});});
    return ()=>{live=false;};
  },[]);
  if(!renderer||!stream.toURL)return <View style={{flex:1}}/>;
  const Video=renderer.View;
  return <Video streamURL={stream.toURL()} mirror={mirror} zOrder={preview?1:0} objectFit="cover" style={{flex:1,borderRadius:12}}/>;
}
