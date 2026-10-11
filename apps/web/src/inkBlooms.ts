import type { InkRegion } from "./memberInk";

export type InkBloom = { id: string; x: number; y: number; rx: number; ry: number; angle: number; opacity: number };

/** One continuous deposit per location, shaped by all of its current members. */
export function inkBlooms(regions: InkRegion[], positions: Map<string, {x:number;y:number}>, width: number): InkBloom[] {
  const byId = new Map(regions.map(region=>[region.id,region]));
  const members = (id: string, visited = new Set<string>()): InkRegion["points"] => {
    if(visited.has(id)) return []; visited.add(id);
    return [...(byId.get(id)?.points || []), ...regions.filter(region=>region.parentId===id).flatMap(region=>members(region.id,visited))];
  };
  return regions.map(region => {
    const children = regions.some(child=>child.parentId===region.id);
    const points = members(region.id).map(point=>({...point,...(positions.get(point.id)||point),weight:Math.sqrt(Math.max(1,point.weight))}));
    const total = points.reduce((sum,p)=>sum+p.weight,0)||1;
    const x=points.reduce((sum,p)=>sum+p.x*p.weight,0)/total, y=points.reduce((sum,p)=>sum+p.y*p.weight,0)/total;
    let xx=0,xy=0,yy=0;
    for(const p of points){xx+=(p.x-x)**2*p.weight/total;xy+=(p.x-x)*(p.y-y)*p.weight/total;yy+=(p.y-y)**2*p.weight/total;}
    const angle=.5*Math.atan2(2*xy,xx-yy), root=Math.sqrt((xx-yy)**2+4*xy*xy);
    const base=Math.max(55,Math.min(125,width*.12)) + Math.log2(1+region.count)*9;
    return {id:region.id,x,y,angle,rx:base+Math.sqrt(Math.max(0,(xx+yy+root)/2))*1.7,ry:base*.85+Math.sqrt(Math.max(0,(xx+yy-root)/2))*1.7,opacity:children?.18:region.id==='unlocated'?.2:.58};
  });
}
