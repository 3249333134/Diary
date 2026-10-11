import { describe, expect, it } from "vitest";
import { inkBlooms } from "./inkBlooms";
import type { InkRegion } from "./memberInk";
const place:InkRegion={id:'place',count:2,points:[{id:'place',x:100,y:100,weight:2},{id:'member',x:140,y:120,weight:1}]};
describe('location ink deposits',()=>{
  it('keeps one deposit per place and expands with members, without moving unrelated places',()=>{
    const other={...place,id:'other',points:[{id:'other',x:500,y:500,weight:1}]};
    const before=inkBlooms([place,other],new Map(),1000);
    const after=inkBlooms([place,other],new Map([['member',{x:600,y:200}]]),1000);
    expect(after).toHaveLength(2);
    expect(after[0].rx).toBeGreaterThan(before[0].rx);
    expect(after[0].x).toBeGreaterThan(before[0].x);
    expect(after[1]).toEqual(before[1]);
    expect(place.points[1].x).toBe(140);
  });
  it('uses descendant positions for the enclosing parent wash and supports empty input',()=>{
    const parent={id:'root',count:2,points:[{id:'root',x:100,y:100,weight:2}]};
    const child={...place,parentId:'root'};
    const before=inkBlooms([parent,child],new Map(),375);
    const after=inkBlooms([parent,child],new Map([['member',{x:600,y:500}]]),375);
    expect(after[0].rx).toBeGreaterThan(before[0].rx);
    expect(after[0].opacity).toBeLessThan(after[1].opacity);
    expect(inkBlooms([],new Map(),375)).toEqual([]);
  });
});
