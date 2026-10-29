import {createContext,useContext,useEffect,useRef,useState,useCallback,type RefObject} from 'react';
import {CalendarDays,Feather,Plus,Users,UserRound,Copy,Check,LockKeyhole} from 'lucide-react';
import type {SocialSnapshot,SharedWindow,SocialPerson,SocialChange,PlanCategory} from '@diary/contracts';
import {api,invalidatePlanReads} from './api';
import {fullSocialChange,normalizeSocialChange,mergeSocialChanges,reconcileSocial,pendingSocialRequests} from './socialRefresh';
import {GlassSelect} from './GlassSelect';
import {GlassChoices} from './GlassChoices';
import {ObsidianDevices} from './ObsidianDevices';
import {usePlanCategories} from './PlanCategories';
import './social.css';

const empty:SocialSnapshot={profile:{code:'',name:''},friends:[],requests:[],invitations:[],windows:[],notices:[],cursor:0};
export function useSocialState(userId?:number){
 const [data,setData]=useState(empty),[error,setError]=useState(''),[connected,setConnected]=useState(false),[planRevision,setPlanRevision]=useState(0),[diaryChange,setDiaryChange]=useState({revision:0,dates:undefined as string[]|undefined});
 const identity=useRef(userId),generation=useRef(0),loadedAccount=useRef<number|undefined>(undefined),snapshot=useRef(empty),pending=useRef<SocialChange|undefined>(undefined),flight=useRef<Promise<void>|undefined>(undefined);
 if(identity.current!==userId){identity.current=userId;generation.current++;pending.current=undefined;flight.current=undefined;}
 const refresh=useCallback((input?:unknown):Promise<void>=>{
  if(!identity.current)return Promise.resolve();const change=input&&Array.isArray((input as SocialChange).domains)?normalizeSocialChange(input):{domains:['social'] as SocialChange['domains']};
  pending.current=pending.current?mergeSocialChanges(pending.current,change):change;if(flight.current)return flight.current;
  const account=identity.current,epoch=generation.current;
  const work=async()=>{while(pending.current&&identity.current===account&&generation.current===epoch){const batch=pending.current;pending.current=undefined;let plans=batch.domains.includes('plans');
   try{if(batch.domains.includes('social')){const next=await api.social();if(identity.current!==account||generation.current!==epoch)return;
    if(next.profile&&Array.isArray(next.windows)){const previous=snapshot.current;if(loadedAccount.current===account&&(JSON.stringify(previous.windows)!==JSON.stringify(next.windows)||JSON.stringify(previous.organizations)!==JSON.stringify(next.organizations)))plans=true;
     const stable=reconcileSocial(previous,next);snapshot.current=stable;loadedAccount.current=account;setData(stable);setError('');}
   }}catch(e){if(identity.current===account&&generation.current===epoch)setError(e instanceof Error?e.message:'通讯暂时无法读取');}
   if(identity.current!==account||generation.current!==epoch)return;
   if(plans){invalidatePlanReads();setPlanRevision(r=>r+1);}
   if(batch.domains.includes('diary'))setDiaryChange(old=>({revision:old.revision+1,dates:batch.dates}));
  }};
  const promise=work().finally(()=>{if(generation.current===epoch)flight.current=undefined;});flight.current=promise;return promise;
 },[]);
 useEffect(()=>{
  if(!userId){snapshot.current=empty;setData(empty);return;}
  let active=true,stream:EventSource|undefined,retry=0,reconnect:number|undefined,timer:number|undefined,queued:SocialChange|undefined;
  const update=(change:SocialChange=fullSocialChange())=>{if(!active)return;queued=queued?mergeSocialChanges(queued,change):change;window.clearTimeout(timer);timer=window.setTimeout(()=>{const batch=queued;queued=undefined;void refresh(batch);},100);};
  const connect=()=>{if(!active)return;stream=new EventSource('/api/social/events',{withCredentials:true});stream.onopen=()=>{retry=0;setConnected(true);};stream.addEventListener('change',event=>{try{update(normalizeSocialChange(JSON.parse((event as MessageEvent).data)));}catch{update();}});stream.onerror=()=>{stream?.close();setConnected(false);reconnect=window.setTimeout(connect,Math.min(30000,1000*2**retry++));};};
  void refresh(fullSocialChange());connect();
  const poll=window.setInterval(()=>{if(document.visibilityState==='visible'&&stream?.readyState!==EventSource.OPEN)update();},15000);
  const visible=()=>{if(document.visibilityState==='visible'&&stream?.readyState!==EventSource.OPEN)update();};document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
  return()=>{active=false;stream?.close();clearInterval(poll);window.clearTimeout(reconnect);window.clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);};
 },[userId,refresh]);
 return {data:loadedAccount.current===userId?data:empty,error,connected,planRevision,diaryChange,refresh};
}

type SocialState=ReturnType<typeof useSocialState>;
export const SocialContext=createContext<SocialState>({data:empty,error:'',connected:false,planRevision:0,diaryChange:{revision:0,dates:undefined},refresh:async()=>{}});
export const useSocial=()=>useContext(SocialContext);
export const editableWindows=(windows:SharedWindow[])=>windows.filter(w=>w.role!=='viewer');
export function SharedScope({value,onChange,disabled=false}:{value?:string;onChange:(id:string)=>void;disabled?:boolean}){
 const {data}=useSocial();
 const opts=[{value:'',label:'私人日程',color:undefined as string|undefined},...editableWindows(data.windows).map(w=>({value:w.id,label:w.name,color:w.color}))];
 return <label className="shared-scope">日程归属<GlassChoices label="日程归属" disabled={disabled} value={value||''} options={opts} onChange={onChange}/>{value&&<small>窗口成员可见 · 完成后所有成员分别生成日记事实</small>}</label>;
}

/** 合并"事项类别 + 日程归属"为一排快选按钮：私人窗口的类别 + 共享窗口，共享窗口前缀"共享" */
export function WindowCategoryPicker({value,onChange,disabled=false}:{value:{windowId?:string;category?:string|null};onChange:(patch:{windowId?:string;category?:string|null})=>void;disabled?:boolean}){
 const {data}=useSocial();
 const {categories}:{categories:PlanCategory[]}=usePlanCategories();
 return <label className="window-category-picker"><span>创建到</span>
 <GlassChoices label="创建目标" disabled={disabled} value={value.windowId||value.category||''} onChange={pick=>{
   if(!pick) onChange({windowId:undefined,category:null});
   else if(editableWindows(data.windows).some(w=>w.id===pick)) onChange({windowId:pick,category:null});
   else onChange({windowId:undefined,category:pick||null});
 }} options={[
   {value:'',label:'待分类'},
   ...categories.map((c:PlanCategory)=>({value:c.id,label:c.name,color:c.color})),
   ...editableWindows(data.windows).map(w=>({value:w.id,label:`共享 · ${w.name}`,color:w.color}))
 ]}/>
 {value.windowId&&<small>共享窗口 · 成员可见 · 完成后所有成员分别生成日记事实</small>}
 </label>;
}
export type MainPage='plan'|'diary'|'communications'|'mine';
export function MainNavigation({page,onPage,onCreate,trigger,hasDraft}:{page:MainPage;onPage:(page:MainPage)=>void;onCreate:()=>void;trigger:RefObject<HTMLButtonElement|null>;hasDraft:boolean}){
 const {data}=useSocial(),unread=pendingSocialRequests(data),ordinary=data.unreadNoticeCount??data.notices.filter(n=>!n.read).length;
 const tab=(key:MainPage,label:string,Icon:typeof CalendarDays)=><button type="button" aria-current={page===key?'page':undefined} aria-label={label} onClick={()=>onPage(key)}><span className="global-nav-icon"><Icon size={21}/>{key==='communications'&&unread>0&&<b className="nav-badge">{unread>99?'99+':unread}</b>}{key==='communications'&&!unread&&ordinary>0&&<i className="nav-unread-dot" aria-label="有未读通知"/>}</span><small>{label}</small></button>;
 return <nav className="global-navigation" aria-label="主导航">{tab('plan','日程',CalendarDays)}{tab('diary','日记',Feather)}<button ref={trigger} type="button" className="global-create workspace-create-button" aria-label="新建日程或日记" aria-haspopup="dialog" onClick={onCreate}><Plus size={27}/><span className="sr-only">新建</span>{hasDraft&&<i className="draft-dot" aria-label="有新增草稿"/>}</button>{tab('communications','通讯',Users)}{tab('mine','我的',UserRound)}</nav>;
}
export {SharedWindowManager as SharedWindowDialog} from './SharedWindowManager';
export {Communications} from './Organizations';

export function MyAccount({username,theme,onTheme,onLogout,onDemo}:{username:string;theme:string;onTheme:()=>void;onLogout:()=>void;onDemo:(code:string)=>Promise<void>}){
 const {data}=useSocial(),[copied,setCopied]=useState(false),[error,setError]=useState(''),[accounts,setAccounts]=useState<SocialPerson[]>([]),[busy,setBusy]=useState(false);
 useEffect(()=>{void api.demoAccounts().then(r=>{if(Array.isArray(r.accounts))setAccounts(r.accounts);}).catch(()=>{});},[]);
 const copy=async()=>{try{await navigator.clipboard.writeText(data.profile.code);setCopied(true);}catch{setError('复制失败，可选中好友码手动复制');}};
 return <section className="social-workspace" aria-label="我的"><header className="social-heading"><h1>我的</h1></header><div className="social-body"><div className="account-identity"><span className="social-avatar">{username.slice(0,1)}</span><div><h2>{username}</h2><small>云端账号</small></div></div><section className="account-section"><h2>我的好友码</h2><p>发送给朋友，对方申请并经你同意后成为好友。</p><div className="friend-code"><input aria-label="我的好友码" readOnly value={data.profile.code||'正在读取…'} onFocus={e=>e.target.select()}/><button className="quiet-button" disabled={!data.profile.code} onClick={()=>void copy()}>{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'已复制':'复制'}</button></div></section><section className="account-section"><h2>偏好与连接</h2><button className="account-row" onClick={onTheme}>主题 <span>{theme==='light'?'浅色':'深色'} · 点击切换</span></button><ObsidianDevices/></section>{accounts.length>0&&<section className="account-section"><h2>本地演示身份</h2><p>仅隔离演示可用，用不同身份验证申请、共享与同步。</p><GlassSelect label="演示身份" value={data.profile.code} disabled={busy} options={accounts.map(a=>({value:a.code,label:a.name}))} onChange={code=>{setBusy(true);void onDemo(code).catch(e=>setError(e instanceof Error?e.message:'切换失败')).finally(()=>setBusy(false));}}/></section>}{error&&<p role="alert">{error}</p>}<button className="quiet-button account-logout" onClick={onLogout}><LockKeyhole size={18}/>退出登录</button></div></section>;
}
