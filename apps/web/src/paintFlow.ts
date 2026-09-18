/** Shared world-space velocity/pressure grid for the interactive paint approximation. */
export type FlowBounds = { left: number; top: number; right: number; bottom: number };
export class PaintFlow {
  cell = 14;
  left = 0; top = 0; columns = 0; rows = 0;
  u = new Float32Array(0); v = new Float32Array(0);
  private pressure = new Float32Array(0);
  energy = 0;
  activeBounds?: FlowBounds;
  ensure(bounds: FlowBounds) {
    if (this.columns && bounds.left >= this.left && bounds.top >= this.top && bounds.right <= this.left + (this.columns - 1) * this.cell && bounds.bottom <= this.top + (this.rows - 1) * this.cell) return;
    const left = Math.floor(Math.min(bounds.left - 60, this.columns ? this.left : Infinity) / this.cell) * this.cell;
    const top = Math.floor(Math.min(bounds.top - 60, this.rows ? this.top : Infinity) / this.cell) * this.cell;
    const right = Math.max(bounds.right + 60, this.left + this.columns * this.cell);
    const bottom = Math.max(bounds.bottom + 60, this.top + this.rows * this.cell);
    const oldCell = this.cell;
    const cell = Math.max(oldCell, Math.ceil(Math.sqrt((right - left) * (bottom - top) / 45000)));
    const columns = Math.ceil((right - left) / cell) + 1, rows = Math.ceil((bottom - top) / cell) + 1;
    const u = new Float32Array(columns * rows), v = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      u[y * columns + x] = this.at(this.u, left + x * cell, top + y * cell);
      v[y * columns + x] = this.at(this.v, left + x * cell, top + y * cell);
    }
    this.left = left; this.top = top; this.cell = cell; this.columns = columns; this.rows = rows;
    this.u = u; this.v = v; this.pressure = new Float32Array(u.length);
  }
  at(values: Float32Array, px: number, py: number) {
    const x = (px - this.left) / this.cell, y = (py - this.top) / this.cell;
    if (x < 0 || y < 0 || x >= this.columns - 1 || y >= this.rows - 1) return 0;
    const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy, i = iy * this.columns + ix;
    return (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - ty) + (values[i + this.columns] * (1 - tx) + values[i + this.columns + 1] * tx) * ty;
  }
  inject(ax: number, ay: number, bx: number, by: number, seconds: number, strength: number) {
    const radius = 95;
    const bounds = { left: Math.min(ax, bx) - radius, top: Math.min(ay, by) - radius, right: Math.max(ax, bx) + radius, bottom: Math.max(ay, by) + radius };
    this.ensure(bounds);
    const old = this.activeBounds;
    this.activeBounds = old ? { left: Math.min(old.left, bounds.left), top: Math.min(old.top, bounds.top), right: Math.max(old.right, bounds.right), bottom: Math.max(old.bottom, bounds.bottom) } : bounds;
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    const speed = Math.min(950, length / Math.max(.008, seconds));
    const vx = dx / Math.max(1, length) * speed, vy = dy / Math.max(1, length) * speed;
    const x0 = Math.max(1, Math.floor((bounds.left - this.left) / this.cell)), x1 = Math.min(this.columns - 2, Math.ceil((bounds.right - this.left) / this.cell));
    const y0 = Math.max(1, Math.floor((bounds.top - this.top) / this.cell)), y1 = Math.min(this.rows - 2, Math.ceil((bounds.bottom - this.top) / this.cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = this.left + x * this.cell, py = this.top + y * this.cell;
      const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (length * length))) : 0;
      const ox = px - ax - t * dx, oy = py - ay - t * dy, distance = Math.hypot(ox, oy);
      if (distance >= radius) continue;
      const influence = (1 - distance / radius) ** 2 * strength, i = y * this.columns + x;
      // A transverse wake rolls the edge instead of uniformly translating a polygon.
      const curl = Math.sin(t * Math.PI * 2 + distance * .045) * speed * .18;
      this.u[i] = Math.max(-950, Math.min(950, this.u[i] * .45 + (vx - oy / radius * curl) * influence));
      this.v[i] = Math.max(-950, Math.min(950, this.v[i] * .45 + (vy + ox / radius * curl) * influence));
    }
    this.energy = Math.max(this.energy, speed);
    return speed;
  }
  step(dt: number) {
    if (!this.columns || this.energy < .5) { this.clear(); return; }
    const n = this.u.length, cols = this.columns;
    const nextU = new Float32Array(n), nextV = new Float32Array(n);
    const decay = Math.exp(-4.2 * dt);
    for (let y = 1; y < this.rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x, px = this.left + x * this.cell - this.u[i] * dt, py = this.top + y * this.cell - this.v[i] * dt;
      // Semi-Lagrangian transport followed by bounded viscous diffusion.
      nextU[i] = (this.at(this.u, px, py) * .76 + (this.u[i - 1] + this.u[i + 1] + this.u[i - cols] + this.u[i + cols]) * .06) * decay;
      nextV[i] = (this.at(this.v, px, py) * .76 + (this.v[i - 1] + this.v[i + 1] + this.v[i - cols] + this.v[i + cols]) * .06) * decay;
    }
    const divergence = new Float32Array(n);
    for (let y = 1; y < this.rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      divergence[i] = (nextU[i + 1] - nextU[i - 1] + nextV[i + cols] - nextV[i - cols]) * .5 * this.cell;
    }
    this.pressure.fill(0);
    for (let iteration = 0; iteration < 12; iteration++) {
      for (let parity = 0; parity < 2; parity++) for (let y = 1; y < this.rows - 1; y++) for (let x = 1 + ((y + parity) % 2); x < cols - 1; x += 2) {
        const i = y * cols + x;
        this.pressure[i] = (this.pressure[i - 1] + this.pressure[i + 1] + this.pressure[i - cols] + this.pressure[i + cols] - divergence[i]) * .25;
      }
    }
    this.energy = 0;
    for (let y = 1; y < this.rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      nextU[i] -= (this.pressure[i + 1] - this.pressure[i - 1]) / (2 * this.cell);
      nextV[i] -= (this.pressure[i + cols] - this.pressure[i - cols]) / (2 * this.cell);
      this.energy = Math.max(this.energy, Math.abs(nextU[i]) + Math.abs(nextV[i]));
    }
    this.u = nextU; this.v = nextV;
  }
  clear() { this.u.fill(0); this.v.fill(0); this.energy = 0; this.activeBounds = undefined; }
}
