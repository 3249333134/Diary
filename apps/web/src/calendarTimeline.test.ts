import { expect,it } from 'vitest';
import { timelineMarkers,timelineOffset,timelineTime,HOUR_WIDTH,DEADLINE_WIDTH } from './calendarTimeline';

it('maps the shared horizontal scale to deadline instants with quarter hour snapping',()=>{
  const hours=[10,15,23];
  expect(timelineOffset('15:30',hours)).toBe(1.5*HOUR_WIDTH);
  expect(timelineTime(HOUR_WIDTH+42,hours)).toBe('15:15');
  expect(timelineTime(HOUR_WIDTH-1,hours)).toBe('10:45');
  expect(timelineTime(-40,hours)).toBe('10:00');
  expect(timelineTime(10000,hours)).toBe('23:45');
  expect(timelineTime(158,[10,11])).toBe('11:00');
  expect(timelineTime(20,[])).toBe('');
});

it('packs dense labels into lanes without shifting deadlines or implying duration',()=>{
  const markers=timelineMarkers([{key:'a',time:'10:00'},{key:'b',time:'10:15'},{key:'c',time:'10:15'},{key:'d',time:'11:00'}],[10,11]);
  expect(markers.get('b')).toEqual({anchor:40,lane:1});
  expect(markers.get('c')).toEqual({anchor:40,lane:2});
  expect(markers.get('d')).toEqual({anchor:160,lane:0});
  const values=[...markers.values()];
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)if(values[i].lane===values[j].lane)expect(Math.abs(values[j].anchor-values[i].anchor)).toBeGreaterThanOrEqual(DEADLINE_WIDTH+8);
});
