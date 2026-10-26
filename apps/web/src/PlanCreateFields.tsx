import type {ParsedTodo} from './api';
import {SharedScope} from './Social';
import {ClassificationFields} from './PlanFields';
import {DateTimeField} from './DateTimeField';
import {RepeatFields} from './RepeatFields';
import {GlassChoices} from './GlassChoices';
import {FieldHint} from './FieldHint';
import {PlanEntityFields,type EntityContext} from './PlanEntities';

export function PlanCreateFields({value,onChange,context}:{value:ParsedTodo;onChange:(patch:Partial<ParsedTodo>)=>void;context:EntityContext}){
 return <>
 <label className="field"><span>标题</span><input data-create-field="content" value={value.title} onChange={e=>onChange({title:e.target.value})}/><FieldHint path="todos.0.title" value={value.title}/></label>
 <label className="field"><span>详情描述</span><textarea data-create-field="description" rows={3} value={value.description||''} onChange={e=>onChange({description:e.target.value})} placeholder="补充说明（可选）"/><FieldHint path="todos.0.description" value={value.description||''}/></label>
 <SharedScope value={value.windowId} onChange={windowId=>onChange({windowId:windowId||undefined})}/>
 <ClassificationFields hideCategory={!!value.windowId} value={value} onChange={onChange}/>
 <div data-create-field="date"><DateTimeField label="截止时间" date={value.dueDate} time={value.dueTime} onChange={(dueDate,dueTime)=>onChange({dueDate,dueTime})}/></div>
 <RepeatFields value={value.repeat||null} onChange={repeat=>onChange({repeat})} checkinEnabled={value.checkinEnabled??false} onCheckinChange={checkinEnabled=>onChange({checkinEnabled})}/>
 <div className="plan-form-pair"><div className="plan-choice-field"><span>优先级</span><GlassChoices label="优先级" value={value.priority} options={[{value:'high',label:'高'},{value:'medium',label:'中'},{value:'low',label:'低'}]} onChange={priority=>onChange({priority})}/></div><label className="field"><span>清单</span><input data-create-field="list" value={value.list} onChange={e=>onChange({list:e.target.value})}/><FieldHint path="todos.0.list" value={value.list}/></label></div>
 <PlanEntityFields context={context} value={value.entities||[]} onChange={entities=>onChange({entities})}/>
 </>;
}
