import { PaintFlow } from "./paintFlow";
export type InkPoint = { id: string; x: number; y: number; weight: number; shareX?: number; shareY?: number };
export type InkRegion = { id: string; parentId?: string; count: number; points: InkPoint[]; footprint?: Array<{ x: number; y: number }> };
export type InkBounds = { left: number; top: number; right: number; bottom: number };
export type InkContour = { id: string; path: string; bounds: InkBounds };
type Particle = InkPoint & { targetX: number; targetY: number };
export type InkDrop = { region: string; x: number; y: number; vx: number; vy: number; life: number; radius: number };
type XY = { x: number; y: number };
type Raster = { gx: number; gy: number; columns: number; rows: number; values: Float32Array; bounds: InkBounds };
const overlaps = (a: InkBounds, b: InkBounds) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

// A solid envelope deliberately fills the space BETWEEN members. No balls or tubes.
function envelope(points: XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (a: XY, b: XY, c: XY) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (items: XY[]) => {
    const result: XY[] = [];
    for (const p of items) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop();
      result.push(p);
    }
    return result;
  };
  const lower = half(sorted), upper = half(sorted.reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function raster(points: XY[], children: Raster[], cell: number): Raster {
  const polygon = envelope(points);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of polygon) {
    left = Math.min(left, p.x - 40); right = Math.max(right, p.x + 40);
    top = Math.min(top, p.y - 40); bottom = Math.max(bottom, p.y + 40);
  }
  for (const child of children) {
    left = Math.min(left, child.bounds.left - 18); right = Math.max(right, child.bounds.right + 18);
    top = Math.min(top, child.bounds.top - 18); bottom = Math.max(bottom, child.bounds.bottom + 18);
  }
  if (!Number.isFinite(left)) { left = top = 0; right = bottom = cell * 2; }
  const gx = Math.floor(left / cell), gy = Math.floor(top / cell);
  const columns = Math.ceil(right / cell) - gx + 1, rows = Math.ceil(bottom / cell) - gy + 1;
  const values = new Float32Array(columns * rows).fill(-1000);
  const edges = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
    return { a, dx, dy, length: Math.hypot(dx, dy) || 1 };
  });
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const px = (gx + x) * cell, py = (gy + y) * cell;
    // All places sample the same mild ink waviness, so contacts remain shared.
    const wx = px + 7 * Math.sin(py * .045) * Math.cos(px * .026) + 2.8 * Math.sin(px * .17 + py * .12);
    const wy = py + 7 * Math.sin(px * .039) * Math.cos(py * .031) + 2.8 * Math.cos(py * .16 - px * .14);
    let distance = Infinity, outside = false, nearest = Infinity;
    for (const e of edges) {
      const signed = (e.dx * (wy - e.a.y) - e.dy * (wx - e.a.x)) / e.length;
      distance = Math.min(distance, signed); outside ||= signed < 0;
      const t = Math.max(0, Math.min(1, ((wx - e.a.x) * e.dx + (wy - e.a.y) * e.dy) / (e.length * e.length)));
      nearest = Math.min(nearest, (wx - e.a.x - t * e.dx) ** 2 + (wy - e.a.y - t * e.dy) ** 2);
    }
    if (outside) distance = -Math.sqrt(nearest);
    values[y * columns + x] = polygon.length >= 3 ? distance + 24 : -1000;
  }
  for (const child of children) for (let y = 0; y < child.rows; y++) for (let x = 0; x < child.columns; x++) {
    const dest = (child.gy + y - gy) * columns + child.gx + x - gx;
    values[dest] = Math.max(values[dest], child.values[y * child.columns + x] + 14);
  }
  return { gx, gy, columns, rows, values, bounds: { left: gx * cell, top: gy * cell, right: (gx + columns - 1) * cell, bottom: (gy + rows - 1) * cell } };
}

function sample(field: Raster, gx: number, gy: number) {
  const x = gx - field.gx, y = gy - field.gy;
  return x < 0 || y < 0 || x >= field.columns || y >= field.rows ? -1000 : field.values[y * field.columns + x];
}

function interpolate(field: Raster, gx: number, gy: number) {
  const x = Math.floor(gx), y = Math.floor(gy), tx = gx - x, ty = gy - y;
  return (sample(field, x, y) * (1-tx) + sample(field, x+1, y) * tx) * (1-ty)
    + (sample(field, x, y+1) * (1-tx) + sample(field, x+1, y+1) * tx) * ty;
}

/** Marching squares with shared grid-edge identities and interpolated crossings. */
function contour(field: Raster, cell: number, neighbours: Raster[]): string {
  const values = field.values.slice();
  for (const other of neighbours) {
    if (!overlaps(field.bounds, other.bounds)) continue;
    const x0 = Math.max(0, other.gx - field.gx), x1 = Math.min(field.columns, other.gx + other.columns - field.gx);
    const y0 = Math.max(0, other.gy - field.gy), y1 = Math.min(field.rows, other.gy + other.rows - field.gy);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const index = y * field.columns + x, own = field.values[index];
      const competing = sample(other, field.gx + x, field.gy + y);
      if (competing > -2) values[index] = Math.min(values[index], (own - competing) * .5);
    }
  }
  const points = new Map<number, [number, number]>(), links = new Map<number, number[]>();
  const vertex = (x: number, y: number, vertical: number) => (y * field.columns + x) * 2 + vertical;
  const edge = (x: number, y: number, vertical: number, a: number, b: number) => {
    const id = vertex(x, y, vertical);
    if (!points.has(id)) {
      const t = Math.max(0, Math.min(1, a / (a - b)));
      points.set(id, [(field.gx + x + (vertical ? 0 : t)) * cell, (field.gy + y + (vertical ? t : 0)) * cell]);
    }
    return id;
  };
  const link = (a: number, b: number) => { links.set(a, [...(links.get(a) || []), b]); links.set(b, [...(links.get(b) || []), a]); };
  for (let y = 0; y < field.rows - 1; y++) for (let x = 0; x < field.columns - 1; x++) {
    const i = y * field.columns + x;
    const a = values[i], b = values[i + 1], c = values[i + field.columns + 1], d = values[i + field.columns];
    const edges: number[] = [];
    if ((a > 0) !== (b > 0)) edges.push(edge(x, y, 0, a, b));
    if ((b > 0) !== (c > 0)) edges.push(edge(x + 1, y, 1, b, c));
    if ((d > 0) !== (c > 0)) edges.push(edge(x, y + 1, 0, d, c));
    if ((a > 0) !== (d > 0)) edges.push(edge(x, y, 1, a, d));
    if (edges.length === 2) link(edges[0], edges[1]);
    else if (edges.length === 4) {
      if ((a + b + c + d > 0) === (a > 0)) { link(edges[0], edges[1]); link(edges[2], edges[3]); }
      else { link(edges[0], edges[3]); link(edges[1], edges[2]); }
    }
  }
  const paths: string[] = [];
  while (links.size) {
    const start = links.keys().next().value!;
    let current = start, previous = -1;
    const loop: Array<[number, number]> = [];
    do {
      loop.push(points.get(current)!);
      const adjacent = links.get(current); links.delete(current);
      if (!adjacent) break;
      const next = adjacent.find(id => id !== previous);
      previous = current;
      if (next === undefined) break;
      current = next;
    } while (current !== start && links.has(current));
    if (loop.length < 3) continue;
    const fmt = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;
    const first = loop[0], last = loop[loop.length - 1];
    let path = `M ${fmt((first[0] + last[0]) / 2, (first[1] + last[1]) / 2)}`;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      path += ` Q ${fmt(a[0], a[1])} ${fmt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)}`;
    }
    paths.push(path + " Z");
  }
  return paths.join(" ");
}

export class MemberInkSimulation {
  private regions: Array<InkRegion & { particles: Particle[]; footprint: XY[] }>;
  private raw = new Map<string, Raster>();
  private dirty = new Set<string>();
  private paint = new Map<string, Raster>();
  private redraw = new Set<string>();
  private evolving = new Set<string>();
  private flow = new PaintFlow();
  private age = 3;
  private clock = new Map<string, number>();
  private immediate = false;
  drops: InkDrop[] = [];
  splashes = true;
  get energy() { return this.flow.energy; }
  begin(id: string, time: number) { this.clock.set(id, time); }
  end(id: string) { this.clock.delete(id); }
  cell: number;
  constructor(regions: InkRegion[], cell = 4) {
    this.cell = cell;
    this.regions = regions.map(region => ({ ...region, particles: region.points.map(point => ({ ...point, targetX: point.x, targetY: point.y })), footprint: region.footprint?.length ? region.footprint : [
      { x: (region.points[0]?.x || 0) - 65, y: (region.points[0]?.y || 0) - 55 },
      { x: (region.points[0]?.x || 0) + 65, y: (region.points[0]?.y || 0) - 55 },
      { x: (region.points[0]?.x || 0) + 65, y: (region.points[0]?.y || 0) + 55 },
      { x: (region.points[0]?.x || 0) - 65, y: (region.points[0]?.y || 0) + 55 },
    ] }));
    regions.forEach(region => this.dirty.add(region.id));
  }
  move(id: string, x: number, y: number, reduced = false, time = performance.now()) {
    if (!Number.isFinite(x + y)) return;
    const members = this.regions.filter(region => region.particles.some(p => p.id === id));
    if (!members.length) return;
    const previous = this.clock.get(id) ?? time - 16.7;
    this.clock.set(id, time);
    const first = members[0].particles.find(p => p.id === id)!;
    if (first.x === x && first.y === y) return;
    const ax = first.x, ay = first.y;
    const weight = members.reduce((sum, r) => sum + (r.particles.find(p => p.id === id)?.weight || 0), 0);
    const speed = reduced ? 0 : this.flow.inject(ax, ay, x, y, (time - previous) / 1000, .7 + Math.min(.6, Math.log2(1 + weight) * .1));
    const previousPaint = this.paint.get(members[0].id);
    const nearEdge = !previousPaint || sample(previousPaint, Math.round(x / this.cell), Math.round(y / this.cell)) < 30;
    if (this.splashes && nearEdge && speed > 420 && this.drops.length < 10) {
      const length = Math.max(1, Math.hypot(x - ax, y - ay)), side = this.drops.length % 2 ? -1 : 1;
      this.drops.push({ region: members[0].id, x, y, vx: (x - ax) / length * 65 - (y - ay) / length * side * 45, vy: (y - ay) / length * 65 + (x - ax) / length * side * 45, life: .48, radius: 2.5 + speed / 400 });
    }
    for (const region of members) for (const p of region.particles) if (p.id === id) {
      p.x = p.targetX = x; p.y = p.targetY = y; this.dirty.add(region.id);
    }
    this.age = 0; this.immediate = reduced;
  }
  settle() {
    this.flow.clear(); this.drops = []; this.age = 3; this.immediate = true;
    for (const id of this.evolving) { const field = this.raw.get(id)!; this.paint.set(id, { ...field, values: field.values.slice() }); this.redraw.add(id); }
    this.evolving.clear();
  }
  step(dt: number): boolean {
    dt = Math.min(1 / 30, Math.max(0, dt));
    this.age += dt;
    this.flow.step(dt);
    this.drops = this.drops.filter(drop => {
      drop.life -= dt; drop.x += drop.vx * dt; drop.y += drop.vy * dt;
      drop.vx *= Math.exp(-5 * dt); drop.vy *= Math.exp(-5 * dt);
      return drop.life > 0;
    });
    const active = this.age < 1.6 || this.flow.energy > .5;
    if (!active) {
      for (const id of this.evolving) { const field = this.raw.get(id)!; this.paint.set(id, { ...field, values: field.values.slice() }); this.redraw.add(id); }
      this.evolving.clear();
      return this.dirty.size > 0;
    }
    for (const [id, field] of this.paint) {
      const target = this.raw.get(id)!;
      if (!this.evolving.has(id) && (!this.flow.activeBounds || !overlaps(field.bounds, this.flow.activeBounds))) continue;
      const values = new Float32Array(field.values.length);
      for (let y = 0; y < field.rows; y++) for (let x = 0; x < field.columns; x++) {
        const i = y * field.columns + x, px = (field.gx + x) * this.cell, py = (field.gy + y) * this.cell;
        const u = this.flow.at(this.flow.u, px, py), v = this.flow.at(this.flow.v, px, py);
        const advected = interpolate(field, (px - u * dt) / this.cell, (py - v * dt) / this.cell);
        const goal = target.values[i], blend = 1 - Math.exp(-9 * dt);
        values[i] = advected + (goal - advected) * blend;
        if (x > 0 && y > 0 && x < field.columns - 1 && y < field.rows - 1 && Math.abs(values[i]) < 18) {
          const smooth = (field.values[i-1] + field.values[i+1] + field.values[i-field.columns] + field.values[i+field.columns]) * .25;
          values[i] += (smooth - values[i]) * .08;
        }
      }
      this.paint.set(id, { ...field, values }); this.redraw.add(id); this.evolving.add(id);
    }
    return true;
  }
  coarsen() { if (this.cell < 9) { this.cell += 1; this.regions.forEach(region => this.dirty.add(region.id)); this.raw.clear(); this.paint.clear(); this.evolving.clear(); } }
  contains(id: string, x: number, y: number) {
    const field = this.raw.get(id);
    return Boolean(field && sample(field, Math.round(x / this.cell), Math.round(y / this.cell)) > 0);
  }
  render(): InkContour[] {
    if (!this.dirty.size && !this.redraw.size) return [];
    // Cap total raster allocation even after a very long drag or a huge imported graph.
    let estimatedArea = 0;
    for (const region of this.regions) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of region.particles) {
        left = Math.min(left, p.x, p.targetX); right = Math.max(right, p.x, p.targetX);
        top = Math.min(top, p.y, p.targetY); bottom = Math.max(bottom, p.y, p.targetY);
      }
      if (Number.isFinite(left)) estimatedArea += (right - left + 160) * (bottom - top + 160);
    }
    const boundedCell = Math.sqrt(estimatedArea / 750000);
    if (boundedCell > this.cell * 1.15) { this.cell = Math.ceil(boundedCell); this.raw.clear(); this.paint.clear(); this.evolving.clear(); this.regions.forEach(region => this.dirty.add(region.id)); }
    const affected = new Set(this.dirty);
    const addParents = (ids: Set<string>) => {
      for (const id of ids) {
        let parent = this.regions.find(region => region.id === id)?.parentId;
        while (parent && !ids.has(parent)) { ids.add(parent); parent = this.regions.find(region => region.id === parent)?.parentId; }
      }
    };
    addParents(affected);
    const oldBounds = [...affected].map(id => this.raw.get(id)?.bounds).filter((b): b is InkBounds => Boolean(b));
    const visited = new Set<string>();
    const build = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const region = this.regions.find(region => region.id === id)!;
      const children = this.regions.filter(child => child.parentId === id);
      for (const child of children) if (affected.has(child.id)) build(child.id);
      // Start from the filled, event-balanced territory, then broaden its envelope
      // toward every current member. The weighted displacement moves the whole field.
      let dx = 0, dy = 0, total = 0;
      region.particles.forEach((p, i) => {
        const weight = Math.sqrt(p.weight);
        dx += (p.x - region.points[i].x) * weight;
        dy += (p.y - region.points[i].y) * weight; total += weight;
      });
      const shift = .35 / Math.max(1, total);
      const points: XY[] = region.footprint.map(p => ({ x: p.x + dx * shift, y: p.y + dy * shift }));
      for (const p of region.particles) {
        points.push({ x: p.x + (p.shareX || 0), y: p.y + (p.shareY || 0) });
        points.push({ x: p.targetX + (p.shareX || 0), y: p.targetY + (p.shareY || 0) });
      }
      const includeChildren = (parent: string) => {
        for (const child of this.regions.filter(item => item.parentId === parent)) {
          points.push(...child.footprint);
          for (const p of child.particles) points.push({ x: p.x, y: p.y }, { x: p.targetX, y: p.targetY });
          includeChildren(child.id);
        }
      };
      includeChildren(id);
      this.raw.set(id, raster(points, children.map(child => this.raw.get(child.id)!).filter(Boolean), this.cell));
    };
    for (const id of affected) build(id);
    // Restore previous contacts too when a region moves away; distant regions are untouched.
    const changedBounds = [...oldBounds, ...[...affected].map(id => this.raw.get(id)!.bounds)];
    for (const region of this.regions) if (changedBounds.some(bounds => overlaps(bounds, this.raw.get(region.id)!.bounds))) affected.add(region.id);
    addParents(affected);
    for (const id of affected) {
      const target = this.raw.get(id)!;
      const current = this.paint.get(id);
      if (!current || this.immediate) this.paint.set(id, { ...target, values: target.values.slice() });
      else if (visited.has(id)) {
        const values = new Float32Array(target.values.length);
        for (let y = 0; y < target.rows; y++) for (let x = 0; x < target.columns; x++)
          values[y * target.columns + x] = Math.max(-45, interpolate(current, target.gx + x, target.gy + y));
        for (const p of this.regions.find(r => r.id === id)!.particles) {
          const cx = Math.round(p.x / this.cell) - target.gx, cy = Math.round(p.y / this.cell) - target.gy, reach = Math.ceil(22 / this.cell);
          for (let y = Math.max(0, cy-reach); y <= Math.min(target.rows-1, cy+reach); y++) for (let x = Math.max(0,cx-reach); x <= Math.min(target.columns-1,cx+reach); x++) {
            const i = y * target.columns + x;
            values[i] = Math.max(values[i], Math.min(target.values[i], 20 - Math.hypot(x-cx,y-cy)*this.cell));
          }
        }
        this.paint.set(id, { ...target, values }); this.evolving.add(id);
      }
      this.redraw.add(id);
    }
    this.immediate = false; this.dirty.clear();
    const drawing = new Set(this.redraw); this.redraw.clear();
    return [...drawing].map(id => {
      const region = this.regions.find(region => region.id === id)!;
      const field = this.paint.get(id)!;
      const children = this.regions.filter(child => child.parentId === id);
      if (children.length) {
        field.values = field.values.slice();
        for (const child of children) {
          const area = this.paint.get(child.id)!;
          for (let y = 0; y < area.rows; y++) for (let x = 0; x < area.columns; x++) {
            const tx = area.gx + x - field.gx, ty = area.gy + y - field.gy;
            if (tx >= 0 && ty >= 0 && tx < field.columns && ty < field.rows) {
              const i = ty * field.columns + tx;
              field.values[i] = Math.max(field.values[i], area.values[y * area.columns + x] + 12);
            }
          }
        }
      }
      const siblings = this.regions.filter(other => other.id !== id && other.parentId === region.parentId).map(other => this.paint.get(other.id)!);
      return { id, path: contour(field, this.cell, siblings), bounds: field.bounds };
    });
  }
}
