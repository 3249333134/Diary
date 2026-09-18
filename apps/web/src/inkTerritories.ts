import type { PlaceRegion } from "./graphData";

// A shared paint field: every sample belongs to exactly one place, so neighbouring
// colours interlock instead of stacking translucent, independent blobs.
export function paintTerritories(regions: PlaceRegion[], width: number, height: number, domain?: { left: number; top: number; width: number; height: number }): PlaceRegion[] {
  if (!regions.length) return regions;
  const left = domain?.left ?? 18, top = domain?.top ?? 130, w = domain?.width ?? Math.max(80, width - 36), h = domain?.height ?? Math.max(120, height - top - 28);
  const sites = regions.map(region => ({ x: (region.x - left) / w, y: (region.y - top) / h }));
  const weights = regions.map(region => Math.max(1, region.count));
  const total = weights.reduce((sum, count) => sum + count, 0);
  const targets = weights.map(count => .08 / regions.length + .92 * count / total);
  const bias = regions.map(() => 0);
  const owner = (x: number, y: number) => {
    let best = Infinity, selected = 0;
    for (let i = 0; i < sites.length; i++) {
      const score = (x - sites[i].x) ** 2 + (y - sites[i].y) ** 2 - bias[i];
      if (score < best) { best = score; selected = i; }
    }
    return selected;
  };
  // Balance the field before adding edge detail; area still follows event counts.
  for (let iteration = 0; iteration < 48; iteration++) {
    const counts = regions.map(() => 0);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 40; x++) counts[owner((x + .5) / 40, (y + .5) / 28)]++;
    for (let i = 0; i < bias.length; i++) bias[i] += .65 * (targets[i] - counts[i] / 1120);
  }
  const cols = Math.ceil(w / 2), rows = Math.ceil(h / 2);
  const dx = w / cols, dy = h / rows;
  const cells = new Int32Array(cols * rows).fill(-1);
  const noise = (x: number, y: number) => Math.sin(x * .073 + Math.sin(y * .051) * 2.4) * Math.cos(y * .089 - Math.cos(x * .047) * 1.8);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = (x + .5) * dx, py = (y + .5) * dy;
    const nx = (px / w - .5) * 2, ny = (py / h - .5) * 2;
    if (nx ** 6 + ny ** 6 > 1.03 + .09 * noise(px, py)) continue;
    const warpX = noise(px * .7, py * .7) * 38 + noise(px * 1.8 + 83, py * 1.8) * 12;
    const warpY = noise(px * .7 + 127, py * .7 - 71) * 38 + noise(px * 1.8, py * 1.8 + 137) * 12;
    cells[y * cols + x] = owner((px + warpX) / w, (py + warpY) / h);
  }
  const boundaries = regions.map(() => new Map<number, number[]>());
  const stats = regions.map(() => ({ count: 0, x: 0, y: 0, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }));
  const vertex = (x: number, y: number) => y * (cols + 1) + x;
  const add = (id: number, a: number, b: number) => {
    const outgoing = boundaries[id].get(a) || [];
    outgoing.push(b); boundaries[id].set(a, outgoing);
  };
  const at = (x: number, y: number) => x < 0 || x >= cols || y < 0 || y >= rows ? -1 : cells[y * cols + x];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const id = at(x, y); if (id < 0) continue;
    const stat = stats[id]; stat.count++; stat.x += left + (x + .5) * dx; stat.y += top + (y + .5) * dy;
    stat.left = Math.min(stat.left, left + x * dx); stat.right = Math.max(stat.right, left + (x + 1) * dx);
    stat.top = Math.min(stat.top, top + y * dy); stat.bottom = Math.max(stat.bottom, top + (y + 1) * dy);
    if (at(x, y - 1) !== id) add(id, vertex(x, y), vertex(x + 1, y));
    if (at(x + 1, y) !== id) add(id, vertex(x + 1, y), vertex(x + 1, y + 1));
    if (at(x, y + 1) !== id) add(id, vertex(x + 1, y + 1), vertex(x, y + 1));
    if (at(x - 1, y) !== id) add(id, vertex(x, y + 1), vertex(x, y));
  }
  return regions.map((region, i) => {
    const stat = stats[i];
    if (!stat.count) return region;
    const cx = stat.x / stat.count, cy = stat.y / stat.count;
    const edges = boundaries[i];
    const paths: string[] = [];
    const point = (id: number) => ({ x: (left + id % (cols + 1) * dx - cx) / region.radius, y: (top + Math.floor(id / (cols + 1)) * dy - cy) / region.radius });
    const fmt = (x: number, y: number) => `${x.toFixed(4)} ${y.toFixed(4)}`;
    while (edges.size) {
      const start = edges.keys().next().value!;
      const loop = [start]; let current = start;
      do {
        const next = edges.get(current);
        if (!next?.length) break;
        const end = next.pop()!;
        if (!next.length) edges.delete(current);
        current = end; if (current !== start) loop.push(current);
      } while (current !== start);
      if (loop.length < 3) continue;
      const raw = loop.map(point);
      // Smooth along the shared contour rather than blurring the colours together.
      // Reversing an edge produces the same average, keeping adjacent paint aligned.
      const points = raw.map((_, j) => {
        let x = 0, y = 0;
        const reach = Math.min(4, Math.floor((raw.length - 1) / 2));
        for (let offset = -reach; offset <= reach; offset++) {
          const p = raw[(j + offset + raw.length) % raw.length]; x += p.x; y += p.y;
        }
        return { x: x / (reach * 2 + 1), y: y / (reach * 2 + 1) };
      }).filter((_, j) => j % 2 === 0);
      const last = points[points.length - 1], first = points[0];
      let path = `M ${fmt((last.x + first.x) / 2, (last.y + first.y) / 2)}`;
      for (let j = 0; j < points.length; j++) {
        const a = points[j], b = points[(j + 1) % points.length];
        path += ` Q ${fmt(a.x, a.y)} ${fmt((a.x + b.x) / 2, (a.y + b.y) / 2)}`;
      }
      paths.push(path + " Z");
    }
    return { ...region, x: cx, y: cy, path: paths.join(" "), bounds: { left: stat.left, right: stat.right, top: stat.top, bottom: stat.bottom }, paintedArea: stat.count * dx * dy, hue: [268, 58, 174, 326, 28, 205][i % 6] };
  });
}
