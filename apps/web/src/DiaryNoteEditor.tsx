import {FieldHint} from './FieldHint';
import {GlassDialog} from './GlassUI';

export function DiaryNoteEditor({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  return <GlassDialog className="diary-note-dialog" label="今日备注" onClose={onClose}>
    <header><h2 id="note-editor-title">今日备注</h2><button className="quiet-button" onClick={onClose}>完成编辑</button></header>
    <label className="sr-only" htmlFor="expanded-day-note">编辑今日备注</label>
    <textarea data-field="facts.note" id="expanded-day-note" autoFocus value={value} onChange={event => onChange(event.target.value)} placeholder="补充今天的感受或背景" /><FieldHint path="facts.note" value={value}/>
    <p>修改沿用日记自动保存；关闭不会丢失内容。</p>
  </GlassDialog>;
}
