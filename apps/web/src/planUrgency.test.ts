import { expect, it } from 'vitest';
import { QUADRANTS, urgency } from './planUrgency';

it('uses the four explicit boolean combinations independently of category or priority', () => {
  for (const q of QUADRANTS) expect(urgency({ important: q.important, urgent: q.urgent })?.id).toBe(q.id);
  expect(new Set(QUADRANTS.map(q => q.color)).size).toBe(4);
});

it('keeps missing classification neutral instead of coercing it to not-important', () => {
  expect(urgency({ important: null, urgent: null })).toBeUndefined();
  expect(urgency({ important: true, urgent: null })).toBeUndefined();
  expect(urgency({ important: false, urgent: false })?.id).toBe('q4');
});
