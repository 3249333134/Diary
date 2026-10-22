import type { Todo } from '@diary/contracts';
import type { CSSProperties } from 'react';

export const QUADRANTS = [
  { id: 'q1', label: '重要紧急', important: true, urgent: true, color: '#bd3d4c' },
  { id: 'q2', label: '重要不紧急', important: true, urgent: false, color: '#7856bd' },
  { id: 'q3', label: '不重要紧急', important: false, urgent: true, color: '#a26416' },
  { id: 'q4', label: '不重要不紧急', important: false, urgent: false, color: '#737785' },
];

export function urgency(task: Pick<Todo, 'important' | 'urgent'>) {
  return QUADRANTS.find(q => q.important === task.important && q.urgent === task.urgent);
}

export function urgencyStyle(task: Pick<Todo, 'important' | 'urgent'>): CSSProperties {
  return { '--urgency-color': urgency(task)?.color || '#737785' } as CSSProperties;
}
