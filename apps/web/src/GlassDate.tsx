import {useState} from 'react';
import {Button,Popover,Dialog,DateField,DateInput,DateSegment,TimeField,Label,Calendar,Heading,CalendarGrid,CalendarGridHeader,CalendarHeaderCell,CalendarGridBody,CalendarCell} from 'react-aria-components';
import {parseDate,parseTime} from '@internationalized/date';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {useOverlayControl} from './GlassUI';
import {planClock} from './planFilters';

export function GlassDate({label,date,time='',onChange,dateOnly=false,timeOnly=false,required=false}:{label:string;date:string;time?:string;onChange:(date:string,time:string)=>void;dateOnly?:boolean;timeOnly?:boolean;required?:boolean}){
 const overlay=useOverlayControl(),[draftDate,setDate]=useState(date),[draftTime,setTime]=useState(time),[onlyDate,setOnlyDate]=useState(dateOnly||!!date&&!time);
 const open=()=>{setDate(date||planClock().date);setTime(time||planClock().time);setOnlyDate(dateOnly||!!date&&!time);overlay.setOpen(true);};
 const close=()=>{overlay.setOpen(false);requestAnimationFrame(()=>{const focused=document.activeElement;if(focused===document.body||focused?.getAttribute('role')==='dialog'||focused===overlay.trigger.current)overlay.trigger.current?.focus({preventScroll:true});});};
 const commit=(d:string,t:string)=>{onChange(d,t);close();};
 const dateValue=draftDate?parseDate(draftDate):null,timeValue=draftTime?parseTime(draftTime):null;
 const display=timeOnly?time:date?date.replaceAll('-','/')+(time&&!dateOnly?' '+time:''):'';
 return <><Button ref={overlay.trigger} className="glass-date-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={overlay.open} onPress={open}><span>{display||'未设置'}</span><CalendarDays size={16}/></Button>
 {overlay.open&&<Popover triggerRef={overlay.trigger} isOpen onOpenChange={open=>{if(!open)close();}} placement="bottom start" offset={8} containerPadding={8} shouldFlip className="glass-popup glass-date-popup"><Dialog aria-label={'选择'+label}>
 <div className="glass-date-body">
 {!timeOnly&&<><DateField aria-label="日期" value={dateValue} onChange={v=>setDate(v?.toString()||'')}><DateInput className="glass-date-segments">{segment=><DateSegment segment={segment}/>}</DateInput></DateField><Calendar aria-label="选择日期" value={dateValue} onChange={v=>setDate(v.toString())} firstDayOfWeek="mon"><header><Button slot="previous" aria-label="上个月"><ChevronLeft size={18}/></Button><Heading/><Button slot="next" aria-label="下个月"><ChevronRight size={18}/></Button></header><CalendarGrid className="glass-calendar-grid"><CalendarGridHeader>{day=><CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader><CalendarGridBody>{day=><CalendarCell date={day} className="glass-calendar-cell"/>}</CalendarGridBody></CalendarGrid></Calendar></>}
 {!dateOnly&&<>{!timeOnly&&<label><input type="checkbox" checked={onlyDate} onChange={e=>setOnlyDate(e.target.checked)}/>仅日期</label>}{(!onlyDate||timeOnly)&&<TimeField aria-label="时间" hourCycle={24} granularity="minute" value={timeValue} onChange={v=>setTime(v?.toString().slice(0,5)||'')}><Label>时间</Label><DateInput className="glass-date-segments">{segment=><DateSegment segment={segment}/>}</DateInput></TimeField>}</>}
 </div><footer>{!required&&<Button className="quiet-button" onPress={()=>commit('','')}>清空</Button>}<Button className="quiet-button" onPress={close}>取消</Button><Button className="save-button" isDisabled={!draftDate||!dateOnly&&!onlyDate&&!draftTime} onPress={()=>commit(draftDate,dateOnly||onlyDate&&!timeOnly?'':draftTime)}>确认</Button></footer>
 </Dialog></Popover>}</>;
}
