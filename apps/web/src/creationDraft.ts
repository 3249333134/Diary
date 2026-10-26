import {diaryEventSchema,textEntrySchema,todoSchema,projectEntries,validationIssues,type Attachment,type CaptureDraft,type DiaryDocument,type FieldIssue,type RecordRef,type TaggedEntity,type TodoAttachment,type TodoRepeat} from '@diary/contracts';

export type CreationKind='plan'|'facts'|'learn'|'input'|'idea';
export const creationLabels={plan:'日程',facts:'事实',learn:'新知',input:'输入',idea:'灵感'};
export type CreationDraft={id:string;kind:CreationKind;ownerDate:string;date:string;time:string;content:string;description:string;entities:TaggedEntity[];tags:string[];attachments:Attachment[];planAttachments:TodoAttachment[];inputKind:string;priority:string;list:string;repeat:TodoRepeat;checkinEnabled?:boolean;category?:string|null;important?:boolean|null;urgent?:boolean|null;startDate?:string;startTime?:string;windowId?:string;source?:RecordRef;needsReview:boolean;reviewReason:string;createdAt?:string;edited?:boolean};
export type CreationRow={draft:CreationDraft;state:'draft'|'saved'|'error';ref?:RecordRef;error?:string;submitted?:CreationDraft;originalText?:string};
export type CreationSession={version:1;manual:Record<string,CreationDraft>;text:string;rows:CreationRow[];submitted:Record<string,CreationDraft>};
export const creationKey=(kind:CreationKind,date:string)=>`${kind}:${date}`;
export const emptyCreationSession=():CreationSession=>({version:1,manual:{},text:'',rows:[],submitted:{}});
export function newCreationDraft(kind:CreationKind,date:string,time:string):CreationDraft{return {id:crypto.randomUUID(),kind,ownerDate:date,date,time,content:'',description:'',entities:[],tags:[],attachments:[],planAttachments:[],inputKind:'书',priority:'medium',list:'',repeat:null,checkinEnabled:false,needsReview:false,reviewReason:'',createdAt:new Date().toISOString()};}
export const creationDirty=(draft:CreationDraft)=>!!(draft.edited||draft.content||draft.description||draft.attachments.length||draft.planAttachments.length);
export const hasCreationDraft=(session:CreationSession)=>!!session.text||session.rows.some(row=>row.state!=='saved')||Object.values(session.manual).some(creationDirty);
export const creationStorageKey=(account:number)=>`diary.creation.v1.${account}`;
export function restoreCreationSession(raw:string|null):CreationSession{
 try{const value=JSON.parse(raw||'null');if(value?.version!==1||!value.manual||!Array.isArray(value.rows)||typeof value.text!=='string')return emptyCreationSession();const valid=(draft:CreationDraft)=>draft&&typeof draft.id==='string'&&typeof draft.content==='string'&&Array.isArray(draft.entities)&&Array.isArray(draft.attachments);if(!Object.values(value.manual).every(d=>valid(d as CreationDraft))||!value.rows.every((r:CreationRow)=>valid(r.draft)))return emptyCreationSession();return {...value,submitted:value.submitted||{}};}catch{return emptyCreationSession();}
}
export function fromCaptureDraft(draft:CaptureDraft,ownerDate:string):CreationDraft{return {...newCreationDraft(draft.kind,draft.date,draft.time),...draft,ownerDate,entities:Object.values(draft.entities).flat(),attachments:[],planAttachments:[],inputKind:'书'};}
export function creationTask(draft:CreationDraft){return todoSchema.parse({id:draft.id,title:draft.content,description:draft.description,dueDate:draft.date,dueTime:draft.time,startDate:draft.startDate,startTime:draft.startTime,category:draft.windowId?undefined:draft.category,important:draft.important,urgent:draft.urgent,entities:draft.entities,priority:draft.priority,list:draft.list,repeat:draft.repeat,checkinEnabled:draft.checkinEnabled,tags:draft.tags,attachments:draft.planAttachments,source:draft.source,createdAt:draft.createdAt});}
export function creationEvent(draft:CreationDraft){return diaryEventSchema.parse({id:draft.id,time:draft.time,note:draft.content,remark:draft.description,tags:draft.tags,attachments:draft.attachments,...Object.fromEntries(['person','place','activity','food'].map((type,i)=>[['people','places','activities','foods'][i],draft.entities.filter(e=>e.type===type)]))});}
export function creationEntry(draft:CreationDraft){return textEntrySchema.parse({id:draft.id,time:draft.time,content:draft.content,sources:draft.entities,tags:draft.tags,attachments:draft.attachments});}
export function creationIssues(draft:CreationDraft):FieldIssue[]{
 const issues:FieldIssue[]=[];
 if((draft.kind!=='plan'&&!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)))issues.push({path:'date',code:'required',message:'请选择日记日期'});
 if(!draft.content.trim())issues.push({path:'content',code:'required',message:draft.kind==='plan'?'请填写日程标题':'请填写正文'});
 if(draft.needsReview)issues.push({path:'needsReview',code:'review_required',message:'请先核对用途和日期'});
 try{if(draft.kind==='plan')creationTask(draft);else if(draft.kind==='facts')creationEvent(draft);else creationEntry(draft);}catch(error){if(error&&typeof error==='object'&&'issues' in error)issues.push(...validationIssues((error as {issues:Parameters<typeof validationIssues>[0]}).issues));}
 return issues;
}
/** Append to a fresh snapshot and preserve IDs so an uncertain write can be retried. */
export function appendCreation(document:DiaryDocument,draft:CreationDraft):DiaryDocument{
 const next=structuredClone(document);
 const existing=[...next.facts.events,...Object.values(next.entries||{}).flat()];if(existing.some(e=>e.id===draft.id))return next;
 if(draft.kind==='facts')next.facts.events.push(creationEvent(draft));
 else if(draft.kind!=='plan'){
  if(!next.entries){const legacy=(kind:'learn'|'input'|'idea',content:string)=>content?[{id:'legacy-'+kind,content,time:'',sources:kind==='learn'?next.learn.sources:kind==='input'?next.input.names:[],tags:kind==='idea'?next.idea.tags:[],attachments:[]}]:[];next.entries={learn:legacy('learn',next.learn.content),input:legacy('input',next.input.excerpt),idea:legacy('idea',next.idea.content)};}
  next.entries[draft.kind].push(creationEntry(draft));if(draft.kind==='input')next.input.kind=draft.inputKind;
 }
 return projectEntries(next);
}

/** Recognition appends a new batch; existing edits and submitted identities stay intact. */
export function appendRecognized(session:CreationSession,drafts:CaptureDraft[],text:string,ownerDate:string):CreationRow[]{
 const ids=new Set(session.rows.map(row=>row.draft.id));
 return drafts.map(value=>{const id=ids.has(value.id)?crypto.randomUUID():value.id;ids.add(id);return {draft:fromCaptureDraft({...value,id},ownerDate),state:'draft',originalText:text};});
}
