import { MemberInkSimulation, type InkRegion } from "./memberInk";

export type InkMessage =
  | { type: "init"; regions: InkRegion[]; mobile: boolean; reduced: boolean }
  | { type: "move"; points: Array<{ id: string; x: number; y: number }>; time?: number }
  | { type: "begin" | "end"; id: string; time: number }
  | { type: "budget" }
  | { type: "pause"; paused: boolean }
  | { type: "reduce"; reduced: boolean };

let simulation: MemberInkSimulation | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let reduced = false, paused = false, mobile = false, previous = 0, slowFrames = 0;
let accumulator = 0, frame = 0, quality = 0;
const reduceQuality = () => {
  if (!simulation || quality >= 4) return;
  quality++;
  if (quality === 1) simulation.splashes = false;
  else if (quality > 2) simulation.coarsen();
};
const run = () => {
  timer = undefined;
  if (!simulation || paused) return;
  const start = performance.now();
  if (reduced) simulation.settle();
  accumulator += previous ? Math.min(.05, (start - previous) / 1000) : 1 / 60;
  let active = true;
  while (accumulator >= 1 / 60) { active = simulation.step(1 / 60); accumulator -= 1 / 60; }
  previous = start;
  const contours = !active || quality < 2 || ++frame % 2 === 0 ? simulation.render() : [];
  const elapsed = performance.now() - start;
  postMessage({ contours, drops: simulation.drops, energy: simulation.energy, active, elapsed, cell: simulation.cell, quality });
  if (elapsed > (mobile ? 26 : 14)) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames >= 3) {
    reduceQuality();
    slowFrames = 0;
  }
  if (active) timer = setTimeout(run, Math.max(0, (mobile ? 30 : 16) - elapsed));
  else previous = 0;
};
const schedule = () => { if (timer === undefined && !paused) timer = setTimeout(run, 0); };
self.onmessage = (event: MessageEvent<InkMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; previous = 0; accumulator = 0; quality = 0; frame = 0;
    mobile = message.mobile; reduced = message.reduced;
    const members = message.regions.reduce((sum, region) => sum + region.points.length, 0);
    simulation = new MemberInkSimulation(message.regions, members >= 400 ? (mobile ? 7 : 5) : (mobile ? 5 : 3.5));
    schedule();
  } else if (message.type === "move") {
    for (const point of message.points) simulation?.move(point.id, point.x, point.y, reduced, message.time);
    schedule();
  } else if (message.type === "budget") { reduceQuality(); schedule(); }
  else if (message.type === "begin") { simulation?.begin(message.id, message.time); }
  else if (message.type === "end") { simulation?.end(message.id); schedule();
  } else if (message.type === "reduce") { reduced = message.reduced; schedule(); }
  else if (message.type === "pause") {
    paused = message.paused;
    if (paused) { if (timer !== undefined) clearTimeout(timer); timer = undefined; simulation?.settle(); previous = 0; accumulator = 0; }
    else schedule();
  }
};
