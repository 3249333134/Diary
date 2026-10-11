import { useEffect, useRef } from 'react';

export function DiaryNoteEditor({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="diary-note-dialog" aria-labelledby="note-editor-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="note-editor-title">今日备注</h2><button className="quiet-button" onClick={onClose}>完成编辑</button></header>
    <label className="sr-only" htmlFor="expanded-day-note">编辑今日备注</label>
    <textarea id="expanded-day-note" autoFocus value={value} onChange={event => onChange(event.target.value)} placeholder="补充今天的感受或背景" />
    <p>修改沿用日记自动保存；关闭不会丢失内容。</p>
  </dialog>;
}
