import { Users } from 'lucide-react';
import './shared-plan.css';

export function SharedPlanBadge({name,compact=false}:{name?:string;compact?:boolean}) {
  return <span className="shared-plan-badge" role="img" aria-label={`共享窗口：${name||'共同日程'}`} title={name||'共享日程'}><Users size={12} aria-hidden="true"/><span>{compact?'共享':`共享 · ${name||'共同日程'}`}</span></span>;
}
