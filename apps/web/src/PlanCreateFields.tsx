import type {ParsedTodo} from './api';
import {WindowCategoryPicker} from './Social';
import {ClassificationFields} from './PlanFields';
import {DateTimeField} from './DateTimeField';
import {RepeatFields} from './RepeatFields';
import {GlassChoices} from './GlassChoices';
import {FieldHint} from './FieldHint';
import {PlanEntityFields,type EntityContext} from './PlanEntities';
import {CreationGroup} from './CreationGroup';

export function PlanCreateFields({value,onChange,context,compact=false,draftId='plan'}:{value:ParsedTodo;onChange:(patch:Partial<ParsedTodo>)=>void;context:EntityContext;compact?:boolean;draftId?:string}){
 const wrap=(id:string,title:string,summary:string,children:React.ReactNode)=>compact?<CreationGroup id={id} draftId={draftId} title={title} summary={summary} defaultOpen={id==='classification'||id==='repeat'}>{children}</CreationGroup>:children;
 return <>
 <label className="field"><span>标题</span><input aria-label="标题" data-create-field="content" value={value.title} onChange={e=>onChange({title:e.target.value})}/><FieldHint path="todos.0.title" value={value.title}/></label>
 <div data-create-field="date"><DateTimeField label="截止时间" date={value.dueDate} time={value.dueTime} onChange={(dueDate,dueTime)=>onChange({dueDate,dueTime})}/></div>
 <WindowCategoryPicker value={{windowId:value.windowId,category:value.category}} onChange={({windowId,category})=>onChange({windowId,category})}/>
 {wrap('classification','分类与优先级',[value.windowId?`共享窗口`:(value.category?'已选类别':'待分类'),typeof value.important==='boolean'?(value.important?'重要':'不重要'):'',typeof value.urgent==='boolean'?(value.urgent?'紧急':'不紧急'):'',value.priority==='high'?'高优先级':value.priority==='low'?'低优先级':'中优先级',value.list].filter(Boolean).join(' · '),<><ClassificationFields start={false} hideCategory value={value} onChange={onChange}/><div className="plan-form-pair"><div className="plan-choice-field" data-create-field="priority"><span>优先级</span><GlassChoices label="优先级" value={value.priority||'medium'} options={[{value:'high',label:'高'},{value:'medium',label:'中'},{value:'low',label:'低'}]} onChange={priority=>onChange({priority})}/></div><label className="field"><span>清单</span><input aria-label="清单" data-create-field="list" value={value.list} onChange={e=>onChange({list:e.target.value})}/><FieldHint path="todos.0.list" value={value.list}/></label></div></>)}
 {wrap('repeat','开始、重复与打卡',[value.startDate&&`开始 ${value.startDate} ${value.startTime||''}`,value.repeat?(({daily:'每日',weekly:'每周',monthly:'每月',yearly:'每年',none:'不重复',after:'完成后重复',custom:'自定义'} as Record<string,string>)[value.repeat.type]||'重复'):'不重复',value.checkinEnabled?'加入打卡':''].filter(Boolean).join(' · '),<><div data-create-field="startDate"><DateTimeField label="原定开始时间" date={value.startDate||''} time={value.startTime||''} onChange={(startDate,startTime)=>onChange({startDate,startTime})}/></div><div data-create-field="repeat"><RepeatFields value={value.repeat||null} onChange={repeat=>onChange({repeat})} checkinEnabled={value.checkinEnabled??false} onCheckinChange={checkinEnabled=>onChange({checkinEnabled})}/></div></>)}
 {wrap('entities','人物地点',[value.description?'有补充说明':'',value.entities?.length?`${value.entities.length}个关联`:''].filter(Boolean).join(' · '),<><label className="field"><span>详情描述</span><textarea aria-label="详情描述" data-create-field="description" rows={3} value={value.description||''} onChange={e=>onChange({description:e.target.value})} placeholder="补充说明（可选）"/><FieldHint path="todos.0.description" value={value.description||''}/></label><PlanEntityFields context={context as any} value={value.entities||[]} onChange={entities=>onChange({entities})}/></>)}
 </>;
}
