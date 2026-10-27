import { createElement, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { VideoStream } from '@/services/calling/callTypes';

export function CallVideo({ stream, mirror = false }: {stream:VideoStream;mirror?:boolean;preview?:boolean}) {
  const video=useRef<HTMLVideoElement|null>(null);
  useEffect(()=>{
    const element=video.current;if(!element)return;
    element.srcObject=stream as MediaStream;
    void element.play().catch(()=>undefined);
    return ()=>{element.pause();element.srcObject=null;};
  },[stream]);
  return <View style={{flex:1,overflow:'hidden',borderRadius:12}}>{createElement('video',{
    ref:video,autoPlay:true,playsInline:true,muted:true,'aria-label':mirror?'Your camera preview':'Trip participant video',
    style:{width:'100%',height:'100%',objectFit:'cover',transform:mirror?'scaleX(-1)':undefined},
  })}</View>;
}
