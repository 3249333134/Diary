import {GlassDate} from './GlassDate';
import type { TodoRepeat } from '@diary/contracts';
import { GlassChoices } from './GlassChoices';
export function RepeatFields({value,onChange}:{value:TodoRepeat;onChange:(value:TodoRepeat)=>void}) {
  const supported=!value||['none','daily','weekly','monthly'].includes(value.type);
  const patch=(p:Partial<NonNullable<TodoRepeat>>)=>onChange({...value!,...p});
  return <fieldset className="repeat-fields"><legend>重复日程</legend><GlassChoices label="重复频率" value={value?.type||'none'} options={[{value:'none',label:'不重复'},{value:'daily',label:'每日'},{value:'weekly',label:'每周'},{value:'monthly',label:'每月'},...(!supported?[{value:value!.type,label:'历史重复规则（保留）',disabled:true}]:[])]} onChange={type=>onChange(type==='none'?null:{type:type as 'daily'|'weekly'|'monthly',interval:1})}/>
    {supported&&value&&value.type!=='none'&&<><label>每隔<input aria-label="重复间隔" type="number" min={1} max={365} value={value.interval||1} onChange={e=>patch({interval:Math.max(1,Math.min(365,Number(e.target.value)||1))})}/><span>{value.type==='daily'?'天':value.type==='weekly'?'周':'月'}</span></label>
      {value.type==='weekly'&&<div className="repeat-weekdays" role="group" aria-label="重复星期">{['日','一','二','三','四','五','六'].map((day,i)=><button type="button" key={day} aria-pressed={value.weekdays?.includes(i)||false} onClick={()=>patch({weekdays:value.weekdays?.includes(i)?value.weekdays.filter(d=>d!==i):[...(value.weekdays||[]),i]})}>周{day}</button>)}<small>未选择时沿用首次日期的星期</small></div>}
      {value.type==='monthly'&&<label>每月日期<input aria-label="每月日期" type="number" min={1} max={31} placeholder="沿用首次日期" value={value.monthDay||''} onChange={e=>patch({monthDay:e.target.value?Math.max(1,Math.min(31,Number(e.target.value))):undefined})}/><small>短月使用最后一天</small></label>}
      <label>结束日期（可选）<GlassDate label="结束日期" dateOnly date={value.until||''} onChange={until=>patch({until})}/></label></>}
  </fieldset>;
}
