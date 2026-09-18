import { describe, expect, it } from "vitest";
import { PaintFlow } from "./paintFlow";
import { MemberInkSimulation } from "./memberInk";

describe("viscous paint motion", () => {
  it("responds to speed, decays after release and stays finite through reversals", () => {
    const slow = new PaintFlow(), fast = new PaintFlow();
    slow.inject(0, 0, 100, 0, 1, 1); fast.inject(0, 0, 100, 0, .1, 1);
    slow.step(1/60); fast.step(1/60);
    expect(fast.energy).toBeGreaterThan(slow.energy * 2);
    fast.inject(100, 0, -100, 0, .016, 1); fast.step(1/60);
    expect([...fast.u, ...fast.v].every(Number.isFinite)).toBe(true);
    for (let i=0;i<300;i++) fast.step(1/60);
    expect(fast.energy).toBe(0);
  });
  it("keeps distant areas still and bounds grid allocation after expansion", () => {
    const flow = new PaintFlow();
    flow.ensure({ left: -500, top: -500, right: 500, bottom: 500 });
    flow.inject(0,0,40,0,.1,1); flow.step(1/60);
    expect(Math.abs(flow.at(flow.u, -400, -400))).toBeLessThan(.01);
    flow.ensure({ left:-20000,top:-20000,right:20000,bottom:20000 });
    expect(flow.u.length).toBeLessThan(47000);
  });
  it("advects the paint differently for slow/fast drags and removes short-lived droplets", () => {
    const scene = [{ id: "place", count: 3, points: [{ id:"member",x:0,y:0,weight:2 },{ id:"anchor",x:120,y:80,weight:1 }] }];
    const run = (time: number) => {
      const sim = new MemberInkSimulation(scene,5); sim.render(); sim.begin("member",0);
      sim.move("member",220,80,false,time); sim.render();
      sim.step(1/60); return { sim, path: sim.render()[0].path };
    };
    const slow = run(1000), fast = run(100);
    expect(fast.path).not.toEqual(slow.path);
    expect(fast.sim.drops.length).toBeGreaterThan(0);
    expect(slow.sim.drops.length).toBe(0);
    const released = fast.path;
    for(let i=0;i<12;i++) { fast.sim.step(1/60); fast.sim.render(); }
    fast.sim.step(1/60); expect(fast.sim.render()[0].path).not.toBe(released);
    for(let i=0;i<180;i++) { fast.sim.step(1/60); fast.sim.render(); }
    expect(fast.sim.drops).toEqual([]);
    expect(fast.sim.step(1/60)).toBe(false);
    expect(fast.sim.contains("place",220,80)).toBe(true);
  });
  it("reduced motion snaps without flow or splashes", () => {
    const sim = new MemberInkSimulation([{ id:"place",count:1,points:[{ id:"m",x:0,y:0,weight:1 }] }]);
    sim.render(); sim.move("m",200,200,true); sim.settle(); sim.render();
    expect(sim.energy).toBe(0); expect(sim.drops).toEqual([]);
    expect(sim.step(1/60)).toBe(false);
    expect(sim.contains("place",200,200)).toBe(true);
  });
});
