import type {SearchResult} from '@diary/contracts';
import type {ActionRow} from './api';
export const searchTaskKey=(row:ActionRow)=>`${row.windowId||'private'}:${row.date}:${row.task.id}`;
export function mergeSearchRows(current:ActionRow[],found:ActionRow[]){return [...new Map([...current,...found].map(row=>[searchTaskKey(row),row])).values()];}
export function matchingDates(items:SearchResult[]){return [...new Set(items.filter(item=>!item.row||!!(item.row.task.dueDate||item.row.task.plannedDate)).map(item=>item.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();}
export function nearestSearchDate(dates:string[],date:string){return [...dates].sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(date))-Math.abs(Date.parse(b)-Date.parse(date))||a.localeCompare(b))[0];}
