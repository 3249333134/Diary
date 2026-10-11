import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultInkColors, readInkColors, regionInkColor } from "./inkColors";
import type { PlaceRegion } from "./graphData";

const root: PlaceRegion = { id:"place|园区",label:"园区",x:0,y:0,radius:10,path:"",count:1,hue:210,neutral:false };
const child = { ...root,id:"place|书房",ancestorIds:[root.id],parentId:root.id,tone:2 };
afterEach(() => vi.unstubAllGlobals());
describe("local ink palette", () => {
  it("recovers from unavailable or malformed storage and rejects non-colors", () => {
    vi.stubGlobal("localStorage",{getItem:()=>{throw new Error("blocked");}});
    expect(readInkColors()).toEqual(defaultInkColors());
    vi.stubGlobal("localStorage",{getItem:()=>'{"sea":"bad","places":{"place|园区":"#ff1133","other":"url(x)"}}'});
    expect(readInkColors()).toEqual({sea:defaultInkColors().sea,places:{"place|园区":"#ff1133"}});
  });
  it("inherits custom family colors while retaining child variation and overrides", () => {
    const colors = {sea:"#123456",places:{[root.id]:"#e044aa"}};
    const inherited = regionInkColor(child,[root,child],colors);
    expect(inherited).toMatch(/^#[a-f0-9]{6}$/);
    expect(inherited).not.toBe(colors.places[root.id]);
    expect(regionInkColor(child,[root,child],{...colors,places:{...colors.places,[child.id]:"#1122ff"}})).toBe("#1122ff");
    expect(regionInkColor(root,[root],defaultInkColors())).toBe(regionInkColor(root,[child,root],defaultInkColors()));
  });
});
