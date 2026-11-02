import {useLayoutEffect,useRef,useState} from 'react';
import {Button} from 'react-aria-components';
import {CalendarDays} from 'lucide-react';
import {useOverlayControl} from './GlassUI';
import {planClock} from './planFilters';

const ROW = 40;

type WheelItem = { value: string; label: string };

/** 滚轮列：整行吸附，滚动停止后取最近的一行 */
function Wheel({ label, items, value, onChange }: {
  label: string;
  items: WheelItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const index = Math.max(0, items.findIndex(item => item.value === value));

  // 外部值变化（换月导致天数变化等）时把滚轮对齐到对应行
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const target = index * ROW;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [index, items]);

  const settle = () => {
    const el = host.current;
    if (!el) return;
    const next = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
    el.scrollTo({ top: next * ROW, behavior: 'smooth' });
    if (items[next] && items[next].value !== value) onChange(items[next].value);
  };

  const jump = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index + delta));
    if (items[next]) onChange(items[next].value);
  };

  return (
    <div
      ref={host}
      className="ios-wheel"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(settle, 150);
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowUp') { event.preventDefault(); jump(-1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); jump(1); }
      }}
    >
      <div className="ios-wheel-pad" aria-hidden="true" />
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          role="option"
          aria-selected={item.value === value}
          tabIndex={-1}
          className={`ios-wheel-item${item.value === value ? ' active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
      <div className="ios-wheel-pad" aria-hidden="true" />
    </div>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

export function GlassDate({label,date,time='',onChange,dateOnly=false,timeOnly=false,required=false}:{label:string;date:string;time?:string;onChange:(date:string,time:string)=>void;dateOnly?:boolean;timeOnly?:boolean;required?:boolean}){
 const overlay=useOverlayControl();
 const [draftDate,setDate]=useState(date),[draftTime,setTime]=useState(time),[mode,setMode]=useState<'date'|'time'>('date');
 const open=()=>{setDate(date||planClock().date);setTime(dateOnly?'':time);setMode(timeOnly?'time':'date');overlay.setOpen(true);};
 const close=()=>{overlay.setOpen(false);requestAnimationFrame(()=>{const focused=document.activeElement;if(focused===document.body||focused?.getAttribute('role')==='dialog'||focused===overlay.trigger.current)overlay.trigger.current?.focus({preventScroll:true});});};
 const commit=(value:string,at:string)=>{onChange(value,at);close();};
 const display=timeOnly?time:date?date.replaceAll('-','/')+(time&&!dateOnly?' '+time:''):'';

 const year=Number(draftDate.slice(0,4))||Number(planClock().date.slice(0,4));
 const month=Number(draftDate.slice(5,7))||1;
 const day=Number(draftDate.slice(8,10))||1;
 const hour=Number((draftTime||planClock().time).slice(0,2))||0;
 const minute=Number((draftTime||planClock().time).slice(3,5))||0;
 const dateLabel=draftDate?`${year}年${month}月${day}日`:'选择日期';

 const pickDate=(nextYear:number,nextMonth:number,nextDay:number)=>{
   const last=daysInMonth(nextYear,nextMonth);
   setDate(`${nextYear}-${pad(nextMonth)}-${pad(Math.min(nextDay,last))}`);
 };
 const pickTime=(nextHour:number,nextMinute:number)=>setTime(`${pad(nextHour)}:${pad(nextMinute)}`);
 const switchMode=(next:'date'|'time')=>{
   if(next==='time'&&!draftTime)setTime(planClock().time);
   setMode(next);
 };

 return <><Button ref={overlay.trigger} className="glass-date-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={overlay.open} onPress={open}><span>{display||'未设置'}</span><CalendarDays size={16}/></Button>
 {overlay.open&&<div className="ios-picker-overlay" onPointerDown={event=>{if(event.target===event.currentTarget)close();}}>
  <div className="ios-picker-sheet glass-popup" role="dialog" aria-modal="true" aria-label={'选择'+label} onKeyDown={event=>{if(event.key==='Escape')close();}}>
   <header className="ios-picker-header">
    {!timeOnly&&<button type="button" className="ios-picker-mode" data-active={mode==='date'} onClick={()=>switchMode('date')}>{dateLabel}</button>}
    {!dateOnly&&<button type="button" className="ios-picker-mode" data-active={mode==='time'} onClick={()=>switchMode('time')}>{draftTime||'选择时间'}</button>}
   </header>
   <div className="ios-picker-wheels">
    <div className="ios-picker-band" aria-hidden="true" />
    {mode==='date'?<>
      <Wheel label="年" value={String(year)} items={Array.from({length:201},(_,i)=>({value:String(1900+i),label:`${1900+i}年`}))} onChange={next=>pickDate(Number(next),month,day)}/>
      <Wheel label="月" value={String(month)} items={Array.from({length:12},(_,i)=>({value:String(i+1),label:`${i+1}月`}))} onChange={next=>pickDate(year,Number(next),day)}/>
      <Wheel label="日" value={String(day)} items={Array.from({length:daysInMonth(year,month)},(_,i)=>({value:String(i+1),label:`${i+1}日`}))} onChange={next=>pickDate(year,month,Number(next))}/>
    </>:<>
      <Wheel label="小时" value={String(hour)} items={Array.from({length:24},(_,i)=>({value:String(i),label:pad(i)}))} onChange={next=>pickTime(Number(next),minute)}/>
      <Wheel label="分钟" value={String(minute)} items={Array.from({length:60},(_,i)=>({value:String(i),label:pad(i)}))} onChange={next=>pickTime(hour,Number(next))}/>
    </>}
   </div>
   <footer className="ios-picker-footer">
    {!required&&<button type="button" className="ios-picker-clear" onClick={()=>commit('','')}>清空</button>}
    <button type="button" className="quiet-button ios-picker-action" onClick={close}>取消</button>
    <button type="button" className="save-button ios-picker-action" disabled={!draftDate} onClick={()=>commit(draftDate,dateOnly?'':draftTime)}>确定</button>
   </footer>
  </div>
 </div>}</>;
}
