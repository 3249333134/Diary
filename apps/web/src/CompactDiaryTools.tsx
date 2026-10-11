import { useEffect, useRef } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { DiaryDocument } from '@diary/contracts';
import { addDays, today } from './date';

export function CompactDiaryTools({ date, onDate, diary, update, onClose, onExpand, onReceipts }: {
  date: string; onDate: (date: string) => void; diary: DiaryDocument;
  update: (diary: DiaryDocument) => void; onClose: () => void; onExpand: () => void; onReceipts: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog=ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-label="日期与今日信息" className="plan-edit-dialog" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="compact-sheet">
      <header><div><h2>日期与今日信息</h2><p>直接编辑，返回后保持紧凑浏览。</p></div><button className="square-button" aria-label="关闭日期与今日信息" onClick={onClose}><X size={20}/></button></header>
      <div className="compact-date-picker"><button className="square-button" aria-label="前一天" onClick={()=>onDate(addDays(date,-1))}><ChevronLeft/></button><label>日记日期<input type="date" value={date} onChange={event=>{if(event.target.value)onDate(event.target.value);}}/></label><button className="square-button" aria-label="后一天" onClick={()=>onDate(addDays(date,1))}><ChevronRight/></button><button className="quiet-button" onClick={()=>onDate(today())}>今天</button></div>
      <fieldset disabled={diary.date!==date} className="compact-day-fields"><legend>当天信息</legend>{(['weather','sleep','mood'] as const).map((key,index)=><label key={key}>{['天气','睡眠','心情'][index]}<input value={diary[key]} onChange={event=>update({...diary,[key]:event.target.value})}/></label>)}<label className="compact-note-field">今日备注<textarea rows={3} value={diary.facts.note} onChange={event=>update({...diary,facts:{...diary.facts,note:event.target.value}})}/></label></fieldset>
      <footer><button className="quiet-button" onClick={onReceipts}><BookOpen size={18}/>每日小票</button><button className="quiet-button" onClick={onExpand}>展开完整顶部</button><button className="save-button" onClick={onClose}>完成编辑</button></footer>
    </div>
  </dialog>;
}
