import { expect,it } from 'vitest';
import { visibleWeekHours,timeAtOffset,timeTop } from './calendarHours';
it('hides every empty hour and omits an all-day-only timeline',()=>{
 expect(visibleWeekHours(['10:30','20:00','10:00',''])).toEqual([10,20]);
 expect(visibleWeekHours([''])).toEqual([]);
 expect(visibleWeekHours([],true)).toHaveLength(24);
});
it('maps compressed positions to the original hours and snaps to 15 minutes',()=>{
 const hours=[10,20];
 expect(timeTop('20:30',hours)).toBe(72);
 expect(timeAtOffset(60,hours)).toBe('20:15');
 expect(timeAtOffset(47,hours)).toBe('10:45');
 expect(timeAtOffset(-20,hours)).toBe('10:00');
 expect(timeAtOffset(500,hours)).toBe('20:45');
 expect(timeAtOffset(540,visibleWeekHours([],true))).toBe('11:15');
 expect(timeAtOffset(47,visibleWeekHours([],true))).toBe('01:00');
});

import { deadlineMarkers } from './calendarHours';
it('separates dense deadline callouts while keeping exact time anchors',()=>{
 const markers=deadlineMarkers([{key:'a',time:'14:00'},{key:'b',time:'14:15'},{key:'c',time:'15:00'},{key:'d',time:'15:00'}],[14,15]);
 const values=[...markers.values()];expect(values.map(m=>m.anchor)).toEqual([0,12,48,48]);
 for(let i=1;i<values.length;i++)expect(values[i].top-values[i-1].top).toBeGreaterThanOrEqual(48);
 expect(markers.get('b')!.anchor).toBe(12);
});
