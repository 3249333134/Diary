import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
type Result={isFinal:boolean;0:{transcript:string}};
type Recognition={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;abort:()=>void;onresult:((event:{results:ArrayLike<Result>})=>void)|null;onend:(()=>void)|null;onerror:((event:{error:string})=>void)|null};
type Constructor=new()=>Recognition;
const factory=()=>{const w=window as unknown as {SpeechRecognition?:Constructor;webkitSpeechRecognition?:Constructor};return w.SpeechRecognition||w.webkitSpeechRecognition;};
export function VoiceInput({text,disabled,onText,onParse,onListening,compact=false}:{compact?:boolean;text:string;disabled:boolean;onText:(value:string)=>void;onParse:(value:string)=>void;onListening:(value:boolean)=>void}) {
  const [listening,setListening]=useState(false),[interim,setInterim]=useState(''),[error,setError]=useState('');
  const active=useRef<Recognition|null>(null),callbacks=useRef({onText,onParse,onListening});callbacks.current={onText,onParse,onListening};
  const initial=useRef(''),final=useRef(''),cancelled=useRef(false),failed=useRef(false);
  const cancel=()=>{cancelled.current=true;active.current?.abort();active.current=null;setListening(false);setInterim('');callbacks.current.onListening(false);callbacks.current.onText(initial.current);};
  useEffect(()=>()=>{cancelled.current=true;const r=active.current;if(r){r.onend=null;r.onresult=null;r.onerror=null;r.abort();}callbacks.current.onListening(false);},[]);
  const start=()=>{
    const Ctor=factory();if(!Ctor){setError('此浏览器暂不支持语音识别，请使用文字输入。');return;}
    const r=new Ctor();active.current=r;initial.current=text;final.current='';cancelled.current=false;failed.current=false;setError('');
    r.lang='zh-CN';r.continuous=true;r.interimResults=true;
    r.onresult=e=>{let confirmed='',pending='';for(let i=0;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)confirmed+=result[0].transcript;else pending+=result[0].transcript;}final.current=confirmed;callbacks.current.onText([initial.current,confirmed].filter(Boolean).join('\n'));setInterim(pending);};
    r.onerror=e=>{failed.current=true;setError(({ 'not-allowed':'麦克风权限被拒绝，请允许后重试。','audio-capture':'没有可用麦克风，请检查设备。','network':'语音服务连接失败，已保留文字。','no-speech':'未听到清晰语音，请重试。','service-not-allowed':'浏览器语音服务不可用，请使用文字输入。'} as Record<string,string>)[e.error]||'语音识别中断，已保留文字。');};
    r.onend=()=>{active.current=null;setListening(false);setInterim('');callbacks.current.onListening(false);if(!cancelled.current&&!failed.current&&final.current.trim())callbacks.current.onParse([initial.current,final.current].filter(Boolean).join('\n'));};
    try{r.start();setListening(true);callbacks.current.onListening(true);}catch{active.current=null;setError('语音服务启动失败，请使用文字输入。');}
  };
  return <div className="voice-input" data-compact={compact||undefined}><div className="voice-controls">{listening?<><span role="status" className={compact?"sr-only":"voice-listening"}>正在聆听…</span><button type="button" className="quiet-button" onClick={()=>active.current?.stop()}><Square size={16}/><span className={compact?"sr-only":undefined}>停止并整理</span></button><button type="button" className="quiet-button" aria-label={compact?"取消语音输入":undefined} onClick={cancel}><X size={16}/><span className={compact?"sr-only":undefined}>取消</span></button></>:<button type="button" className="quiet-button" disabled={disabled} onClick={start}><Mic size={17}/><span className={compact?"sr-only":undefined}>语音输入</span></button>}</div>{interim&&<p className="voice-interim" aria-live="polite">{interim}</p>}{error&&<p role="alert">{error}</p>}</div>;
}
