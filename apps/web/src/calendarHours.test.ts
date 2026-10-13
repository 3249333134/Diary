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
