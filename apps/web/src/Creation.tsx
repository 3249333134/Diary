import {useEffect,useRef,useState,type RefObject} from 'react';
import {ArrowUp,Check,Trash2} from 'lucide-react';
import {validationMessage,type RecordRef,type FieldIssue} from '@diary/contracts';
import {GlassDialog} from './GlassUI';
import {GlassSegments} from './GlassSegments';
import {CreationFields} from './CreationFields';
import {VoiceInput} from './VoiceInput';
import {FieldHint} from './FieldHint';
import {api,ApiError} from './api';
import {planClock} from './planFilters';
import {useSocial,editableWindows} from './Social';
import {useGlassConfirm} from './GlassConfirm';
import type {EntityContext} from './PlanEntities';
import {creationLabels,creationDirty,creationIssues,creationKey,creationStorageKey,emptyCreationSession,appendRecognized,hasCreationDraft,newCreationDraft,restoreCreationSession,type CreationDraft,type CreationKind} from './creationDraft';
import './creation.css';

export type CreationRequest={id:number;kind:CreationKind;date:string;preset?:Partial<CreationDraft>;defaults?:Partial<Record<CreationKind,Partial<CreationDraft>>>};
export type CreationResult={ref:RecordRef;refreshWarning?:string;createdCount?:number};
export function Creation({account,open,request,onClose,trigger,context,onSave,onCreated,onDraftChange,planDisabled,diaryDisabled}:{account:number;open:boolean;request?:CreationRequest;onClose:()=>void;trigger:RefObject<HTMLButtonElement|null>;context:EntityContext;onSave:(draft:CreationDraft)=>Promise<CreationResult>;onCreated:(result:CreationResult)=>void;onDraftChange:(hasDraft:boolean)=>void;planDisabled:boolean;diaryDisabled:boolean}){
 const {data}=useSocial();
 const confirmation=useGlassConfirm();
 const [session,setSession]=useState(()=>{try{return restoreCreationSession(localStorage.getItem(creationStorageKey(account)));}catch{return emptyCreationSession();}});
 const [manualKey,setManualKey]=useState(''),[activeRow,setActiveRow]=useState<string>(),[lastDiaryKind,setLastDiaryKind]=useState<CreationKind>('facts');
 const [saving,setSaving]=useState(false),[parsing,setParsing]=useState(false),[uploading,setUploading]=useState(false),[listening,setListening]=useState(false),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[message,setMessage]=useState(''),[progress,setProgress]=useState({current:0,total:0});
 const guard=useRef(false),parseGuard=useRef(false),mounted=useRef(true),body=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
 const current=session.rows.find(row=>row.draft.id===activeRow),draft=current?.draft||session.manual[manualKey],submitted=current?.submitted||(!activeRow?session.submitted[manualKey]:undefined);
 const busy=saving||uploading;
 const selectManual=(kind:CreationKind,init=request)=>{
  if(!init)return;
  const clock=planClock(),date=kind==='plan'?clock.date:init.date,preset=kind==='plan'?init.preset:init.defaults?.[kind];
  const key=creationKey(kind,date)+(preset?.windowId?':'+preset.windowId:'')+(preset?.source?':'+preset.source.id:'');
  setSession(old=>old.manual[key]?old:{...old,manual:{...old.manual,[key]:{...newCreationDraft(kind,date,clock.time),...preset}}});
  setManualKey(key);setActiveRow(undefined);setError('');if(kind!=='plan')setLastDiaryKind(kind);
 };
 useEffect(()=>{if(request)selectManual(request.kind,request);},[request?.id]);
 useEffect(()=>{onDraftChange(hasCreationDraft(session));try{if(hasCreationDraft(session))localStorage.setItem(creationStorageKey(account),JSON.stringify(session));else localStorage.removeItem(creationStorageKey(account));setStorageError('');}catch{setStorageError('本地空间不足，暂时只能在当前页面保留草稿，请勿刷新。');}},[session,account,onDraftChange]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(body.current)body.current.scrollTop=0;},[manualKey,activeRow]);
 useEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=Math.min(78,Math.max(44,el.scrollHeight))+'px';}},[session.text,open]);
 const close=()=>{if(guard.current||uploading)return;onClose();requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};
 const patch=(value:Partial<CreationDraft>)=>{if(guard.current||parsing||submitted)return;setError('');setSession(old=>activeRow?{...old,rows:old.rows.map(row=>row.draft.id===activeRow?{...row,draft:{...row.draft,...value},error:undefined}:row)}:{...old,manual:{...old.manual,[manualKey]:{...old.manual[manualKey],...value,edited:true}}});};
 const switchKind=(kind:CreationKind)=>{
  if(!activeRow)selectManual(kind);else patch({kind,...kind!=='plan'&&!draft?.date?{date:request?.date||planClock().date}:{}});
  if(kind!=='plan')setLastDiaryKind(kind);
 };
 const focusIssue=(issue?:FieldIssue)=>{
  const path=issue?.path||'',field=/remark|description/.test(path)?'description':/title|note|content|excerpt/.test(path)?'content':path;
  requestAnimationFrame(()=>{const container=body.current?.querySelector<HTMLElement>(`[data-create-field="${CSS.escape(field)}"]`)||body.current?.querySelector<HTMLElement>('[data-create-field="content"]'),el=container?.matches('input,textarea,button')?container:container?.querySelector<HTMLElement>('button,input:not([hidden]),textarea')||container;el?.scrollIntoView({block:'center'});el?.focus({preventScroll:true});});
 };
 const pending=session.rows.filter(row=>row.state!=='saved');
 const canParse=!!session.text.trim()&&session.text.length<=10000&&!parsing&&!listening&&!busy;
 const parse=async(text=session.text)=>{
  if(parseGuard.current||guard.current||!text.trim()||text.length>10000)return;
  parseGuard.current=true;setParsing(true);setError('');setMessage('');
  try{
   const result=await api.parseCapture(text);if(!mounted.current)return;
   const rows=appendRecognized(session,result.drafts,text,planClock().date);
   setSession(old=>({...old,text:'',rows:[...old.rows,...rows]}));setActiveRow(rows[0]?.draft.id);
   setMessage(result.mode==='ai'?'已加入待创建，可继续输入，核对后一起创建。':'AI 暂不可用，原文已保留，请核对用途和日期。');
  }catch(e){if(mounted.current){const clock=planClock(),draft={...newCreationDraft(request?.kind||'facts',request?.kind==='plan'?clock.date:request?.date||clock.date,clock.time),content:text,needsReview:true,reviewReason:'AI 未能识别，请手动核对用途和日期'};setSession(old=>({...old,text,rows:[...old.rows,{draft,state:'draft',originalText:text}]}));setActiveRow(draft.id);setError(validationMessage(e,'识别失败，原文已保留'));}}

  finally{parseGuard.current=false;if(mounted.current)setParsing(false);}
 };
 const permitted=!draft?.windowId||editableWindows(data.windows).some(window=>window.id===draft.windowId);
 const disabled=busy||parsing||listening||(!activeRow&&!draft)||(activeRow?!pending.length:!permitted)||(activeRow?pending.some(row=>row.draft.kind==='plan'?planDisabled:diaryDisabled):draft?.kind==='plan'?planDisabled:diaryDisabled);
 const create=async()=>{
  if(disabled||guard.current||!draft)return;
  const batch=activeRow?pending.map(row=>({rowId:row.draft.id,snapshot:structuredClone(row.submitted||row.draft)})):[{rowId:undefined,snapshot:structuredClone(submitted||draft)}];
  for(const item of batch){
   const issues=creationIssues(item.snapshot);
   if(item.snapshot.windowId&&!editableWindows(data.windows).some(window=>window.id===item.snapshot.windowId))issues.unshift({path:'windowId',code:'forbidden',message:'共享权限已变化，请选择可协作窗口或改为私人日程'});
   if(issues.length){if(item.rowId)setActiveRow(item.rowId);setError(issues[0].message);focusIssue(issues[0]);return;}
  }
  guard.current=true;setSaving(true);setError('');setProgress({current:0,total:batch.length});
  const key=manualKey;let saved=0,last:CreationResult|undefined,warning='',failed=false;
  try{
   for(const {rowId,snapshot} of batch){
    setProgress({current:saved+1,total:batch.length});
    setSession(old=>rowId?{...old,rows:old.rows.map(row=>row.draft.id===rowId?{...row,submitted:snapshot}:row)}:{...old,submitted:{...old.submitted,[key]:snapshot}});
    try{
     const result=await onSave(snapshot);if(!mounted.current)return;last=result;warning ||= result.refreshWarning||'';saved++;
     setSession(old=>{
      if(rowId)return {...old,rows:old.rows.map(row=>row.draft.id===rowId?{...row,state:'saved',ref:result.ref,error:undefined}:row)};
      const manual={...old.manual},submitted={...old.submitted};delete manual[key];delete submitted[key];return {...old,manual,submitted};
     });
    }catch(e){
     if(!mounted.current)return;failed=true;
     const text=validationMessage(e,'创建失败，草稿已保留'),safeToEdit=e instanceof ApiError&&[400,401,403,409].includes(e.status);
     setError((saved?`已创建 ${saved} 项；`:'')+text+(e instanceof ApiError&&e.data.requestId?`（请求编号 ${e.data.requestId}）`:''));
     if(rowId)setActiveRow(rowId);
     setSession(old=>{
      if(rowId)return {...old,rows:old.rows.map(row=>row.draft.id===rowId?{...row,state:'error',error:text,...safeToEdit?{submitted:undefined}:{}}:row)};
      if(!safeToEdit)return old;const submitted={...old.submitted};delete submitted[key];return {...old,submitted};
     });
     if(e instanceof ApiError)focusIssue(e.data.issues?.[0]);break;
    }
   }
   if(last)onCreated({...last,createdCount:saved,refreshWarning:warning||undefined});
   if(!failed){
    if(!activeRow&&pending.length){setActiveRow(pending[0].draft.id);setMessage('已创建手动内容，剩余草稿可一起创建。');}
    else{onClose();requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));}
   }
  }finally{guard.current=false;if(mounted.current)setSaving(false);}
 };

 if(!open||!request)return null;
 const otherManual=Object.entries(session.manual).filter(([key,draft])=>(key!==manualKey||!!activeRow)&&creationDirty(draft));
 const queueActive=!!activeRow,label=queueActive?`一起创建（${pending.length}）`:'创建';
 return <GlassDialog label="新建日程或日记" onClose={close} busy={busy} overlayClassName="creation-overlay" className="creation-dialog">
  {confirmation.dialog}
  <header className="creation-header"><h2>新建</h2><GlassSegments label="创建类型" value={draft?.kind==='plan'?'plan':'diary'} options={[{value:'plan',label:'日程'},{value:'diary',label:'日记'}]} disabled={busy||parsing||!!submitted} onChange={value=>switchKind(value==='plan'?'plan':lastDiaryKind)}/></header>
  <div className="creation-body" ref={body}>
   <div className="creation-form">
    {draft?.kind!=='plan'&&<GlassSegments label="日记类型" value={draft?.kind||'facts'} options={(['facts','learn','input','idea'] as const).map(value=>({value,label:creationLabels[value]}))} disabled={busy||parsing||!!submitted} onChange={switchKind}/>}
    {(!!session.rows.length||!!otherManual.length)&&<nav className="creation-queue" aria-label="新增草稿"><button type="button" disabled={busy} aria-pressed={!queueActive} onClick={()=>{setActiveRow(undefined);setError('');}}>手动填写</button>{otherManual.map(([key,draft])=><button type="button" key={key} disabled={busy} onClick={()=>{setManualKey(key);setActiveRow(undefined);setError('');}}>手动草稿 · {creationLabels[draft.kind]} · {draft.content.slice(0,16)||draft.date}</button>)}{session.rows.map((row,i)=><button type="button" disabled={busy} key={row.draft.id} aria-pressed={activeRow===row.draft.id} onClick={()=>{setActiveRow(row.draft.id);setError(row.error||'');}}>{row.state==='saved'&&<Check size={13}/>}草稿 {i+1} · {creationLabels[row.draft.kind]}{row.state==='saved'?' · 已创建':''}</button>)}</nav>}
    {(storageError||error)&&<p className="creation-error" role="alert">{error||storageError}</p>}
    {message&&<p className="creation-message" role="status">{message}</p>}{current?.originalText&&<details className="creation-original"><summary>识别原文</summary><p>{current.originalText}</p></details>}
    {!permitted&&<div className="creation-error" role="status">共享窗口权限已变化，草稿保留，当前无法创建。<button type="button" className="quiet-button" disabled={busy} onClick={()=>patch({windowId:undefined})}>改为私人日程</button></div>}
    {current?.state==='saved'?<div className="creation-saved"><Check/><p>这条已创建，剩余草稿仍可一起创建。</p><button type="button" className="quiet-button" onClick={()=>{setActiveRow(undefined);setError('');}}>返回手动填写</button></div>:draft&&<fieldset className="creation-fields" disabled={busy||parsing||!!submitted||!permitted}><CreationFields draft={draft} ai={!!activeRow} onChange={patch} context={context} onUploading={setUploading}/></fieldset>}
    {submitted&&!saving&&current?.state!=='saved'&&<p role="status">已保留上次提交内容。请重试确认结果，避免重复创建。</p>}
    {queueActive&&current?.state!=='saved'&&!submitted&&<div className="creation-draft-tools"><small>移除后不再参与一起创建</small><button type="button" className="creation-discard" disabled={busy} onClick={()=>{setSession(old=>({...old,rows:old.rows.filter(row=>row.draft.id!==activeRow)}));setActiveRow(undefined);setError('');}}><Trash2 size={16}/>移除当前草稿</button></div>}
    {!queueActive&&draft&&creationDirty(draft)&&!submitted&&<div className="creation-draft-tools"><small>仅清除本次未保存内容</small><button type="button" className="creation-discard" aria-label="清空当前草稿" disabled={busy} onClick={()=>void(async()=>{if(await confirmation.confirm('清空当前新增草稿？已保存的记录不会受影响。')){const clock=planClock();setSession(old=>({...old,manual:{...old.manual,[manualKey]:newCreationDraft(draft.kind,draft.kind==='plan'?clock.date:request.date,clock.time)}}));setError('');focusIssue({path:'content',code:'',message:''});}})()}><Trash2 size={16}/>清空草稿</button></div>}
   </div>
  </div>
  <footer className="creation-footer">
   {(pending.length>0||listening||parsing||!!session.text)&&<div className="creation-assist" role="status">{listening?'正在聆听…':parsing?'AI 正在整理，原文已保留…':pending.length?`待创建 ${pending.length} 条，可继续输入 AI 内容`:'交给已配置的 AI 整理，核对后创建。'}</div>}
   <div className="creation-action-bar"><div className="creation-ai-input"><textarea ref={input} aria-label="AI 输入" rows={1} value={session.text} disabled={busy||parsing||listening} placeholder="AI 输入…" onChange={e=>setSession(old=>({...old,text:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(canParse)void parse();}}}/><VoiceInput compact text={session.text} disabled={busy||parsing} onText={text=>setSession(old=>({...old,text}))} onParse={text=>void parse(text)} onListening={setListening}/>{!listening&&<button type="button" aria-label="识别 AI 输入" title="识别为草稿" disabled={!canParse} onClick={()=>void parse()}>{parsing?<span className="creation-working">…</span>:<ArrowUp size={19}/>}</button>}</div><div className="creation-buttons"><button type="button" className="creation-cancel" disabled={busy} aria-label="取消新增" onClick={close}>取消</button><button type="button" className="creation-submit" disabled={disabled} onClick={()=>void create()}>{saving?`创建 ${progress.current}/${progress.total}`:submitted&&!queueActive?'重试创建':label}</button></div></div>
   <FieldHint path="content" limit={10000} value={session.text}/>
  </footer>
 </GlassDialog>;
}
