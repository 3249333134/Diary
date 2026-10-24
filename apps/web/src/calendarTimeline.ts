import { HOUR_HEIGHT, timeAtOffset, timeTop } from './calendarHours';

export const HOUR_WIDTH=160;
export const DEADLINE_WIDTH=148;
export const LANE_HEIGHT=64;

export const timelineOffset=(time:string,hours:number[])=>timeTop(time,hours)*HOUR_WIDTH/HOUR_HEIGHT;
export const timelineTime=(offset:number,hours:number[])=>timeAtOffset(offset*HOUR_HEIGHT/HOUR_WIDTH,hours);

export function hiddenHourRanges(hours:number[]) {
  return hours.flatMap((hour,index)=>index&&hour>hours[index-1]+1?[{index,from:`${String(hours[index-1]+1).padStart(2,'0')}:00`,to:`${String(hour-1).padStart(2,'0')}:59`}]:[]);
}

export function offscreenDirection(left:number,right:number,visibleLeft:number,visibleRight:number) {
  return right<=visibleLeft?'left':left>=visibleRight?'right':undefined;
}

/** Each card labels one instant. Pack colliding labels into lanes without moving its anchor. */
export function timelineMarkers(items:{key:string;time:string}[],hours:number[]) {
  const ends:number[]=[];
  return new Map([...items].sort((a,b)=>a.time.localeCompare(b.time)||a.key.localeCompare(b.key)).map(item=>{
    const anchor=timelineOffset(item.time,hours);
    let lane=ends.findIndex(end=>end+8<=anchor);
    if(lane<0)lane=ends.length;
    ends[lane]=anchor+DEADLINE_WIDTH;
    return [item.key,{anchor,lane}];
  }));
}
