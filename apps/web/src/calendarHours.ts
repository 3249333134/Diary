export const HOUR_HEIGHT=48;
export function visibleWeekHours(times:string[],full=false):number[] {
  return full?Array.from({length:24},(_,hour)=>hour):[...new Set(times.filter(Boolean).map(time=>Number(time.slice(0,2))))].sort((a,b)=>a-b);
}
export function timeTop(time:string,hours:number[]) {
  const [hour,minute]=time.split(':').map(Number);
  return Math.max(0,hours.indexOf(hour))*HOUR_HEIGHT+minute/60*HOUR_HEIGHT;
}
export function timeAtOffset(offset:number,hours:number[]) {
  if(!hours.length)return '';
  const position=Math.max(0,offset)/HOUR_HEIGHT;
  const index=Math.min(hours.length-1,Math.floor(position));
  const snapped=Math.max(0,Math.round((position-index)*60/15)*15);
  if(snapped===60&&hours[index+1]===hours[index]+1)return `${String(hours[index+1]).padStart(2,'0')}:00`;
  const minute=Math.min(45,snapped);
  return `${String(hours[index]).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}
