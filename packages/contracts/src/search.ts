import type {RecordRef,Todo,ScheduleSpan} from './index.js';
export type SearchScope='all'|'todo'|'diary';
export type SearchResult={ref:RecordRef;title:string;excerpt:string;date:string;tags:string[];people:string[];windowName?:string;categoryName?:string;information?:boolean;row?:{date:string;version:string;task:Todo;span?:ScheduleSpan;windowId?:string;windowName?:string;readOnly?:boolean;role?:'owner'|'viewer'|'editor';seriesVersion?:string;sourceExists:boolean;completionExists:boolean}};
export type SearchResponse={items:SearchResult[];total:number;nextOffset?:number};
export type SearchTerm={field:'text'|'tag'|'person'|'task'|'event'|'date'|'place'|'activity'|'food'|'kind'|'category'|'window';value:string};
export const normalizeSearch=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
const fields:Record<string,SearchTerm['field']>={标签:'tag',tag:'tag',人物:'person',person:'person',任务:'task',日程:'task',task:'task',事件:'event',event:'event',日期:'date',date:'date',地点:'place',place:'place',活动:'activity',activity:'activity',食物:'food',food:'food',类型:'kind',type:'kind',分类:'category',类别:'category',category:'category',窗口:'window',window:'window'};
export function searchTerms(query:string):SearchTerm[]{
 const parsed=(query.match(/[^\s"“]+[:：]["“][^"”]+["”]|["“][^"”]+["”]|[^\s]+/g)||[]).map<SearchTerm>(raw=>{
  if(raw.startsWith('#'))return{field:'tag',value:normalizeSearch(raw.slice(1))};
  const pair=/^([^:：]+)[:：](.*)$/.exec(raw),field=pair&&fields[normalizeSearch(pair[1])];
  return{field:field||'text',value:normalizeSearch((field?pair![2]:raw).replace(/^["“]|["”]$/g,''))};
 });
 const result:SearchTerm[]=[];for(const term of parsed){const previous=result.at(-1);if(term.field==='text'&&previous&&previous.field!=='text'&&!previous.value)previous.value=term.value;else result.push(term);}return result;
}


export type SearchDocument={kind:RecordRef['kind'];title:string;body:string;date:string;ownerDate?:string;tags:string[];people:string[];aliases?:string[];entities:{type:string;name:string;tags:string[]}[];categoryName?:string;windowName?:string;shared?:boolean;information?:boolean;start?:string;end?:string};
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh-CN',{granularity:'word'}):undefined;
const stopWords=new Set(['我','的','去','和','与','了','在','要','想','一下','一个','的任务','的日程']);
/** One matcher for in-view filtering and deep search; callers retain their own permission and scope checks. */
export function createSearchMatcher(query:string){
 const terms=searchTerms(query).map(term=>({...term,words:segmenter?[...segmenter.segment(term.value)].filter(s=>s.isWordLike&&!stopWords.has(s.segment)&&s.segment.length>1).map(s=>s.segment):[]}));
 return(document:SearchDocument):number|undefined=>{
  const task=document.kind==='todo',aliases=document.aliases||[],body=normalizeSearch([document.body,document.date,document.title,document.windowName,document.categoryName,task?(document.shared?'共享 共享日程':'私人 私人日程'):'',...document.tags,...aliases].join('\n')),tags=normalizeSearch([...document.tags,...document.entities.flatMap(e=>e.tags)].join('\n')),names=normalizeSearch([...document.people,...aliases].join('\n'));let score=0;
  for(const term of terms){if(!term.value)return;const text=()=>body.includes(term.value)||term.words.length>1&&term.words.every(word=>body.includes(word));let hit=false;
   switch(term.field){case'category':hit=!!document.categoryName&&normalizeSearch(document.categoryName).includes(term.value);score+=3;break;case'window':hit=task&&normalizeSearch(document.windowName||document.categoryName||'').includes(term.value);score+=3;break;case'tag':hit=tags.includes(term.value);score+=3;break;case'person':hit=names.includes(term.value);score+=3;break;case'task':hit=task&&text();break;case'event':hit=document.kind==='facts'&&!document.information&&text();break;case'place':case'activity':case'food':hit=document.entities.some(e=>e.type===term.field&&normalizeSearch(e.name).includes(term.value));break;case'kind':hit=normalizeSearch(({todo:'日程 任务 todo task',facts:'日记 事实 事件 facts event',learn:'日记 新知 learn',input:'日记 输入 input',idea:'日记 灵感 idea'})[document.kind]).split(' ').includes(term.value);break;case'date':{const range=term.value.split(/\.\.|~|至/),start=document.start?.slice(0,10),end=document.end?.slice(0,10);if(range.length===2&&range.every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v))){hit=start&&end?start<=range[1]&&end>=range[0]:document.date>=range[0]&&document.date<=range[1];break;}hit=document.date.startsWith(term.value)||!task&&!!document.ownerDate?.startsWith(term.value)||!!start&&!!end&&start<=term.value&&end>=term.value;break;}default:hit=text()||tags.includes(term.value);}
   if(!hit)return;if(normalizeSearch(document.title).includes(term.value))score+=4;
  }return score;
 };
}
