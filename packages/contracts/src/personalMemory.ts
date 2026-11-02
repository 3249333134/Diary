import {z} from 'zod';
export const memorySourceSchema=z.object({kind:z.enum(['manual','ai','record']),date:z.string().optional(),recordId:z.string().optional(),recordKind:z.string().optional(),version:z.string().optional(),excerpt:z.string().max(1000).optional()});
export const personalMemorySchema=z.object({
 id:z.string().uuid(),kind:z.enum(['time','place','person','fact']),key:z.string().trim().min(1).max(80),label:z.string().trim().min(1).max(80),value:z.string().trim().min(1).max(1000),
 weekdays:z.array(z.number().int().min(0).max(6)).max(7).default([]),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 aliases:z.array(z.string().trim().min(1).max(80)).max(30).default([]),tags:z.array(z.string().trim().min(1).max(40)).max(30).default([]),enabled:z.boolean().default(true),source:memorySourceSchema.default({kind:'manual'}),updatedAt:z.string().default(''),
}).superRefine((m,ctx)=>{if(m.kind==='time'&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(m.value))ctx.addIssue({code:'custom',path:['value'],message:'时间请使用HH:mm格式'});});
export type PersonalMemory=z.infer<typeof personalMemorySchema>;
export type MemorySource=z.infer<typeof memorySourceSchema>;
export const memoryCandidateSchema=z.object({id:z.string().min(1).max(80),fingerprint:z.string().min(1).max(80),record:personalMemorySchema,evidence:z.string().max(1000)});
export type MemoryCandidate=z.infer<typeof memoryCandidateSchema>;
export type AppliedMemory={id?:string;label:string;value:string;field:'start'|'person'|'place';personId?:string};
export type MemoryMatch={applied:AppliedMemory[];people:{name:string;tags:string[];personId:string}[];places:{name:string;tags:string[]}[];startTime?:string;questions:string[]};
export type PersonalMemorySnapshot={version:string;records:PersonalMemory[];candidates:MemoryCandidate[];pending:number;failed:number};
const norm=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
export function selectTimeMemory(records:PersonalMemory[],key:string,date:string){
 const day=new Date(date+'T12:00:00Z').getUTCDay(),matches=records.filter(m=>m.enabled&&m.kind==='time'&&m.key===key&&(m.date?m.date===date:!m.weekdays.length||m.weekdays.includes(day)));
 const rank=(m:PersonalMemory)=>m.date?3:m.weekdays.length?2:1,score=Math.max(0,...matches.map(rank)),best=matches.filter(m=>rank(m)===score);
 return new Set(best.map(m=>m.value)).size>1?{conflict:true as const}: {record:best[0]};
}
export function chineseClock(text:string){
 const n=(s:string)=>{if(/^\d+$/.test(s))return Number(s);s=s.replaceAll('两','二');const d='零一二三四五六七八九';if(s.includes('十')){const[a,b]=s.split('十');return(a?d.indexOf(a):1)*10+(b?d.indexOf(b):0);}return d.indexOf(s);};
 const m=/(凌晨|早上|上午|中午|下午|傍晚|晚上|晚间)?\s*([0-2]?\d|[零一二三四五六七八九十两]{1,3})(?:[:：]([0-5]\d)|[点时](半|一刻|三刻|[零一二三四五六七八九十两\d]{1,3}分?)?)/.exec(text);
 if(!m)return;let hour=n(m[2]),minute=m[3]?Number(m[3]):m[4]==='半'?30:m[4]==='一刻'?15:m[4]==='三刻'?45:m[4]?n(m[4].replace('分','')):0;
 if(/下午|傍晚|晚上|晚间/.test(m[1]||'')&&hour<12)hour+=12;if(m[1]==='中午'&&hour<11)hour+=12;if(m[1]==='凌晨'&&hour===12)hour=0;
 if(hour<0||hour>23||minute<0||minute>59)return;return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}
export const timeAnchors=[{key:'offWork',word:'下班',label:'下班时间'},{key:'onWork',word:'上班',label:'上班时间'},{key:'wake',word:'起床',label:'起床时间'},{key:'sleep',word:'睡觉',label:'睡觉时间'},{key:'lunch',word:'午休',label:'午休时间'}];
export function explicitAnchorTime(text:string,word:string){
 const parts=text.split(/[，,；;。\n]/);for(const part of parts){if(!part.includes(word))continue;const at=part.indexOf(word),prefix=part.slice(Math.max(0,at-14),at),suffix=part.slice(at+word.length);const before=chineseClock(prefix);if(before)return before;if(/^(?:时间)?(?:一般|通常|平时)?(?:是|为|在|[:：])/.test(suffix)){const after=chineseClock(suffix);if(after)return after;}}
}
/** Exact confirmed aliases only. Ambiguity never silently selects a person. */
export function matchPersonalMemory(text:string,date:string,records:PersonalMemory[]):MemoryMatch{
 const result:MemoryMatch={applied:[],people:[],places:[],questions:[]};
 for(const anchor of timeAnchors){if(!new RegExp(anchor.word+'(?:后|以后|之后|就|去)').test(text))continue;const explicit=chineseClock(text.match(new RegExp(anchor.word+'(?:后|之后|以后)((?:\\s*)(?:上午|下午|晚上|早上)?[零一二三四五六七八九十两\\d][^，,。；;]{0,8})'))?.[1]||'')||explicitAnchorTime(text,anchor.word)||(anchor.key==='offWork'&&/今天.{0,12}加班到/.test(text)?chineseClock(text.match(/加班到([^，,。；;]+)/)?.[1]||''):undefined),selected=selectTimeMemory(records,anchor.key,date);
  if(explicit){result.startTime=explicit;result.applied.push({label:'本次'+anchor.label,value:explicit,field:'start'});}else if('conflict'in selected){result.questions.push(anchor.label+'有多个适用值，请选择');}else if(selected.record){result.startTime=selected.record.value;result.applied.push({id:selected.record.id,label:selected.record.label,value:selected.record.value,field:'start'});}else result.questions.push('还不知道你的'+anchor.label+'，请补充原定开始时间');
 }
 const people=records.filter(m=>m.enabled&&m.kind==='person'),hits=new Map<string,PersonalMemory[]>();
 for(const m of people)for(const alias of [m.label,...m.aliases])if(norm(text).includes(norm(alias))){const group=hits.get(norm(alias))||[];if(!group.some(x=>x.id===m.id))group.push(m);hits.set(norm(alias),group);}
 const accepted=new Map<string,PersonalMemory>();for(const [alias,group]of hits){if(group.length>1){result.questions.push(`“${alias}”匹配多个人，请选择人物`);continue;}accepted.set(group[0].id,group[0]);}
 const ambiguous=new Set([...hits.values()].filter(g=>g.length>1).flatMap(g=>g.map(m=>m.id)));
 for(const m of accepted.values())if(!ambiguous.has(m.id)){result.people.push({name:m.label,tags:m.tags,personId:m.id});result.applied.push({id:m.id,label:m.label,value:m.tags.join(' · ')||m.value,field:'person',personId:m.id});}
 for(const m of records.filter(m=>m.enabled&&m.kind==='place'))if([m.label,...m.aliases].some(alias=>norm(text).includes(norm(alias)))){result.places.push({name:m.value,tags:m.tags});result.applied.push({id:m.id,label:m.label,value:m.value,field:'place'});}
 return result;
}
