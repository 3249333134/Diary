import { useId } from 'react';
import './schedule.css';
import { planClock } from './planFilters';

/** Shanghai wall-clock values are kept as strings, never converted through device time zones. */
export function DateTimeField({label,date,time,onChange,required=false}:{label:string;date:string;time:string;onChange:(date:string,time:string)=>void;required?:boolean}) {
  const id=useId();
  return <div className="datetime-field"><label htmlFor={id}>{label} <small>上海时间</small></label>
    <input id={id} aria-label={label} type={date&&!time?'date':'datetime-local'} value={date?(time?`${date}T${time}`:date):''} required={required}
      onChange={e=>{const [d='',t='']=e.target.value.split('T');onChange(d,t.slice(0,5));}}/>
    <div className="datetime-options"><button type="button" disabled={!date} aria-pressed={!!date&&!time} onClick={()=>onChange(date,time?'':planClock().time)}>{date&&!time?'添加具体时间':'仅日期'}</button><button type="button" onClick={()=>onChange('','')}>清空</button></div>
  </div>;
}
