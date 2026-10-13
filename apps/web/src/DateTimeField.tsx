import {GlassDate} from './GlassDate';
import './schedule.css';
export function DateTimeField({label,date,time,onChange,required=false}:{label:string;date:string;time:string;onChange:(date:string,time:string)=>void;required?:boolean}){
 return <div className="datetime-field"><label>{label}</label><GlassDate label={label} date={date} time={time} onChange={onChange} required={required}/></div>;
}
