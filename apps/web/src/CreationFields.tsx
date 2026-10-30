import {diaryDocumentSchema,fieldLimit,type TodoAttachment} from '@diary/contracts';
import {useRef} from 'react';
import {FileText,Paperclip,X} from 'lucide-react';
import {PlanCreateFields} from './PlanCreateFields';
import {DateTimeField} from './DateTimeField';
import {FieldHint} from './FieldHint';
import {GlassSelect} from './GlassSelect';
import {EntityField} from './EntityField';
import {SharedTagInput} from './PlanFields';
import {PlanEntityFields,type EntityContext} from './PlanEntities';
import {CreationGroup} from './CreationGroup';
import {AttachmentField} from './AttachmentField';
import type {CreationDraft} from './creationDraft';

function PlanAttachments({value,onChange}:{value:TodoAttachment[];onChange:(files:TodoAttachment[])=>void}){
 const input=useRef<HTMLInputElement>(null);
 return <section className="creation-plan-files" data-create-field="attachments" aria-label="日程附件"><div className="creation-file-heading"><h3>附件</h3><button type="button" className="creation-file-picker" onClick={()=>input.current?.click()}><Paperclip size={16}/>选择文件</button></div><input ref={input} aria-label="选择日程附件" type="file" multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]).map(file=>({name:file.name,type:file.type,size:file.size}));onChange([...value,...files]);e.target.value='';}}/>{value.length?<ul className="creation-file-list">{value.map((file,i)=><li key={i}><FileText size={17}/><span className="creation-file-name">{file.name}</span><button type="button" aria-label={`移除附件：${file.name}`} onClick={()=>onChange(value.filter((_,at)=>at!==i))}><X size={17}/></button></li>)}</ul>:<p className="creation-file-empty">尚未选择文件 · 此处记录附件名称</p>}</section>;
}

export function CreationFields({draft,onChange,context,onUploading,ai=false}:{draft:CreationDraft;onChange:(patch:Partial<CreationDraft>)=>void;context:EntityContext;onUploading:(busy:boolean)=>void;ai?:boolean}){
 const textPath=draft.kind==='facts'?'facts.events.0.note':`entries.${draft.kind}.0.content`;
 return <>
 {draft.kind==='plan'?<PlanCreateFields compact draftId={draft.id} value={{...draft,title:draft.content,dueDate:draft.date,dueTime:draft.time}} context={context} onChange={patch=>{const {title,dueDate,dueTime,...rest}=patch;onChange({...rest,...title!==undefined?{content:title}:{},...dueDate!==undefined?{date:dueDate}:{},...dueTime!==undefined?{time:dueTime}:{}});}}/>:<>
  <div data-create-field="date"><DateTimeField label="记录时间" required date={draft.date} time={draft.time} onChange={(date,time)=>onChange({date,time})}/></div>
  {draft.kind==='input'&&<label>当日输入类型<GlassSelect label="输入类型" value={draft.inputKind} options={['书','文章','影视','播客','课程','其他'].map(value=>({value,label:value}))} onChange={inputKind=>onChange({inputKind})}/></label>}
  <label className="field"><span>{draft.kind==='facts'?'事件内容':'正文'}</span><textarea aria-label={draft.kind==='facts'?'事件内容':'正文'} data-create-field="content" rows={draft.kind==='facts'?4:8} value={draft.content} onChange={e=>onChange({content:e.target.value})} placeholder="记下想保留的内容…"/><FieldHint path={textPath} limit={fieldLimit(diaryDocumentSchema,textPath)} value={draft.content}/></label>
  {draft.kind==='facts'&&<CreationGroup id="entities" draftId={draft.id} title="备注与人物地点" summary={[draft.description?'有备注':'',draft.entities.length?`${draft.entities.length}个关联`:''].filter(Boolean).join(' · ')}><label className="field"><span>事件备注</span><textarea aria-label="事件备注" data-create-field="description" rows={3} value={draft.description} onChange={e=>onChange({description:e.target.value})}/><FieldHint path="facts.events.0.remark" value={draft.description}/></label><PlanEntityFields context={context} includeThings={false} value={draft.entities} onChange={entities=>onChange({entities})}/></CreationGroup>}
  {(draft.kind==='learn'||draft.kind==='input')&&<EntityField label={draft.kind==='learn'?'来源':'名称'} type="thing" values={draft.entities.filter(e=>e.type==='thing')} {...context} onChange={entities=>onChange({entities:[...draft.entities.filter(e=>e.type!=='thing'),...entities]})}/>}
  {draft.kind!=='facts'&&(ai||draft.entities.some(entity=>entity.type!=='thing'))&&<CreationGroup id="entities" draftId={draft.id} title="人物地点" summary={`${draft.entities.filter(e=>e.type!=='thing').length}个关联`}><PlanEntityFields includeThings={false} context={context} value={draft.entities.filter(entity=>entity.type!=='thing')} onChange={entities=>onChange({entities:[...draft.entities.filter(entity=>entity.type==='thing'),...entities]})}/></CreationGroup>}
 </>}
 <CreationGroup id="attachments" draftId={draft.id} title="标签与附件" summary={`${draft.tags.length}个标签 · ${draft.kind==='plan'?draft.planAttachments.length:draft.attachments.length}个附件`} defaultOpen={ai&&draft.tags.length>0}>
 <SharedTagInput label="标签" value={draft.tags} onChange={tags=>onChange({tags})}/>
 {draft.kind!=='plan'?<section className="creation-attachments" data-create-field="attachments"><h3>附件</h3><AttachmentField attachments={draft.attachments} date={draft.date} onChange={attachments=>onChange({attachments})} onUploading={onUploading}/></section>:<PlanAttachments value={draft.planAttachments} onChange={planAttachments=>onChange({planAttachments})}/>}
 </CreationGroup>
 {draft.needsReview&&<label className="creation-review" data-create-field="needsReview"><input type="checkbox" checked={false} onChange={()=>onChange({needsReview:false})}/>我已核对用途和日期：{draft.reviewReason}</label>}
 </>;
}
