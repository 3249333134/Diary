import type { ReactNode } from 'react';
import './plan-controls.css';

export function PlanActionDock({ onConfirm, onCancel, label, busy = false, disabled = false, status, className = '' }: {
  onConfirm: () => void; onCancel: () => void; label: string; busy?: boolean; disabled?: boolean; status?: ReactNode; className?: string;
}) {
  return <footer className={'plan-action-dock ' + className} aria-label="任务操作">
    {status && <span className="plan-action-status" role="status">{status}</span>}
    <div className="plan-action-buttons">
      <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="save-button" disabled={busy || disabled} onClick={onConfirm}>{busy ? '正在保存…' : label}</button>
    </div>
  </footer>;
}
