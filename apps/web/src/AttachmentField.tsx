import {useRef,useState} from 'react';
import {Loader2,Plus,X} from 'lucide-react';
import {api} from './api';
export function AttachmentField({ attachments, onChange, date, variant = "full", limit,onUploading }: {onUploading?:(busy:boolean)=>void; attachments: Array<{ path: string; name: string }>; onChange: (list: Array<{ path: string; name: string }>) => void; date: string; variant?: "full" | "strip"; limit?: number }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    onUploading?.(true);
    try {
      const results = [];
      for (const file of Array.from(files)) {
        if (file.size > 8 * 1024 * 1024) { alert(`文件 ${file.name} 超过 8MB，已跳过`); continue; }
        try {
          results.push(await api.upload(file, date));
        } catch (e: any) { alert(`上传 ${file.name} 失败：${e.message}`); }
      }
      if (results.length) onChange([...attachments, ...results.map(r => ({ path: r.path, name: r.name }))]);
    } finally { setUploading(false);onUploading?.(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const remove = (idx: number) => onChange(attachments.filter((_, i) => i !== idx));
  const displayList = limit ? attachments.slice(0, limit) : attachments;
  const overflow = limit && attachments.length > limit ? attachments.length - limit : 0;

  if (variant === "strip") {
    return <div className="attachment-strip">
      {displayList.map((att, idx) => {
        const ext = att.path.split(".").pop()?.toLowerCase() || "";
        const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
        return <div className="attachment-strip-item" key={att.path + idx} title={att.name} onClick={() => window.open(api.assetUrl(att.path), "_blank")}>
          {isImage ? <img src={api.assetUrl(att.path)} alt={att.name} loading="lazy" /> : <span className="attachment-strip-file">{ext.toUpperCase()}</span>}
        </div>;
      })}
      {overflow > 0 && <span className="attachment-strip-more">+{overflow}</span>}
      {uploading ? <div className="attachment-strip-uploading"><Loader2 size={14} className="spin" /></div> : (
        <label className="attachment-strip-add" title="上传附件">
          <Plus size={14} />
          <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.txt" hidden onChange={(e) => void handleFiles(e.target.files)} />
        </label>
      )}
    </div>;
  }

  // full variant — always render so the "+" button is visible even with zero attachments
  return <div className="attachment-grid">
    {attachments.map((att, idx) => {
      const ext = att.path.split(".").pop()?.toLowerCase() || "";
      const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
      return <div className="attachment-item" key={att.path + idx}>
        {isImage
          ? <img src={api.assetUrl(att.path)} alt={att.name} loading="lazy" onClick={() => window.open(api.assetUrl(att.path), "_blank")} />
          : <a href={api.assetUrl(att.path)} target="_blank" rel="noreferrer">{att.name || ext.toUpperCase()}</a>}
        <button type="button" className="attachment-remove" onClick={() => remove(idx)} aria-label={`移除附件${att.name}`}><X size={14} /></button>
      </div>;
    })}
    {uploading && <div className="attachment-uploading"><Loader2 size={18} className="spin" />上传中...</div>}
    <label className="attachment-add" title="添加附件">
      <Plus size={18} />
      <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.txt" hidden onChange={(e) => void handleFiles(e.target.files)} />
    </label>
  </div>;
}

