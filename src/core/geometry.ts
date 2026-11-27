// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Plane geometry for the canopy. Plan coordinates are 2D [x, y]; in the scene x stays x,
// plan y becomes world z, height is world y. All polygons are convex and counter-clockwise.

export type Vec2 = [number, number];
export type Polygon = Vec2[];

export interface Edge {
  a: Vec2;
  b: Vec2;
  /** Inward unit normal. */
  nx: number;
  ny: number;
  len: number;
}

export function polyArea(P: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const p = P[i]!;
    const q = P[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polyCentroid(P: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const p = P[i]!;
    const q = P[(i + 1) % n]!;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of P) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / P.length, sy / P.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Keep the part of P where nx*x + ny*y <= d (Sutherland-Hodgman, one half-plane). */
export function clipHalf(P: readonly Vec2[], nx: number, ny: number, d: number): Polygon {
  const out: Polygon = [];
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % n]!;
    const da = nx * a[0] + ny * a[1] - d;
    const db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : [];
}

export function polyEdges(P: readonly Vec2[]): Edge[] {
  const E: Edge[] = [];
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    E.push({ a, b, nx: -dy / len, ny: dx / len, len });
  }
  return E;
}

/** P moved inward by t on every side. Stays convex; may lose edges; [] when nothing is left. */
export function insetPoly(P: readonly Vec2[], t: number, edges: readonly Edge[] = polyEdges(P)): Polygon {
  let Q: Polygon = [...P];
  for (const e of edges) {
    Q = clipHalf(Q, -e.nx, -e.ny, -(e.nx * e.a[0] + e.ny * e.a[1]) - t);
    if (!Q.length) return [];
  }
  return Q;
}

/** Distance from p to the boundary of P (negative outside). */
export function insetOf(P: readonly Vec2[], p: Vec2): number {
  let m = Infinity;
  for (const e of polyEdges(P)) m = Math.min(m, e.nx * (p[0] - e.a[0]) + e.ny * (p[1] - e.a[1]));
  return m;
}

export const contains = (P: readonly Vec2[], p: Vec2, eps = 0): boolean => P.length >= 3 && insetOf(P, p) >= -eps;

/** Area of the intersection of two convex polygons. */
export function intersectionArea(A: readonly Vec2[], B: readonly Vec2[]): number {
  let P: Polygon = [...A];
  for (const e of polyEdges(B)) {
    P = clipHalf(P, -e.nx, -e.ny, -(e.nx * e.a[0] + e.ny * e.a[1]));
    if (!P.length) return 0;
  }
  return Math.abs(polyArea(P));
}

export interface Circle {
  c: Vec2;
  r: number;
}

// Scratch buffers for insetNonEmpty: the incircle bisection clips thousands of times per morph frame.
let bufA = new Float64Array(64);
let bufB = new Float64Array(64);

/** Whether insetPoly(P, t, E) is non-empty, without allocating (same clipping rule as clipHalf). */
function insetNonEmpty(P: readonly Vec2[], E: readonly Edge[], t: number): boolean {
  const cap = 2 * (P.length + E.length + 2);
  if (bufA.length < cap) {
    bufA = new Float64Array(cap * 2);
    bufB = new Float64Array(cap * 2);
  }
  let src = bufA;
  let dst = bufB;
  let n = P.length;
  for (let i = 0; i < n; i++) {
    src[2 * i] = P[i]![0];
    src[2 * i + 1] = P[i]![1];
  }
  for (const e of E) {
    const nx = -e.nx;
    const ny = -e.ny;
    const d = -(e.nx * e.a[0] + e.ny * e.a[1]) - t;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = src[2 * i]!;
      const ay = src[2 * i + 1]!;
      const bx = src[2 * j]!;
      const by = src[2 * j + 1]!;
      const da = nx * ax + ny * ay - d;
      const db = nx * bx + ny * by - d;
      if (da <= 0) {
        dst[2 * m] = ax;
        dst[2 * m + 1] = ay;
        m++;
      }
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const k = da / (da - db);
        dst[2 * m] = ax + (bx - ax) * k;
        dst[2 * m + 1] = ay + (by - ay) * k;
        m++;
      }
    }
    if (m < 3) return false;
    [src, dst] = [dst, src];
    n = m;
  }
  return true;
}

/** Centre and radius of the largest circle inside P (Chebyshev centre), by bisection on the inset. */
export function incircle(P: readonly Vec2[]): Circle {
  if (P.length < 3) return { c: [0, 0], r: 0 };
  let lo = 0;
  let hi = Math.sqrt(Math.abs(polyArea(P)) / Math.PI) * 1.01 + 1e-9;
  const E = polyEdges(P);
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (insetNonEmpty(P, E, mid)) lo = mid;
    else hi = mid;
  }
  const core = insetPoly(P, lo * 0.999, E);
  const c = core.length ? polyCentroid(core) : polyCentroid(P);
  return { c, r: insetOf(P, c) };
}

/** Distance from c to the boundary of P along the unit direction (dx, dy). c must be inside. */
export function reach(P: readonly Vec2[], c: Vec2, dx: number, dy: number): number {
  let r = Infinity;
  for (const e of polyEdges(P)) {
    const out = -(e.nx * dx + e.ny * dy);
    if (out <= 1e-12) continue;
    const d = e.nx * (c[0] - e.a[0]) + e.ny * (c[1] - e.a[1]);
    r = Math.min(r, d / out);
  }
  return r;
}

export function regularPolygon(n: number, radius: number, cx = 0, cy = 0, phase = 0): Polygon {
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = phase + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  });
}

// ---------------------------------------------------------------- power diagram + treemap

/** Power diagram of sites S with weights W inside the convex polygon B. O(n²) half-plane clips, exact and deterministic. */
export function powerCells(B: readonly Vec2[], S: readonly Vec2[], W: readonly number[]): Polygon[] {
  const n = S.length;
  const cells: Polygon[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let P: Polygon = [...B];
    const s = S[i]!;
    const ss = s[0] * s[0] + s[1] * s[1];
    for (let j = 0; j < n && P.length; j++) {
      if (j === i) continue;
      const t = S[j]!;
      P = clipHalf(P, 2 * (t[0] - s[0]), 2 * (t[1] - s[1]), t[0] * t[0] + t[1] * t[1] - ss + W[i]! - W[j]!);
    }
    cells[i] = P;
  }
  return cells;
}

export interface TreemapItem {
  target: number;
  site: Vec2;
  pin?: boolean;
}

export interface Treemap {
  cells: Polygon[];
  sites: Vec2[];
  weights: number[];
  targets: number[];
  err: number;
  iter: number;
}

/**
 * Area-proportional Voronoi treemap (after Nocaj and Brandes 2012): Lloyd steps move the sites,
 * the power weights adapt until every cell has its target share of B.
 */
export function solveTreemap(B: readonly Vec2[], items: readonly TreemapItem[], { maxIter = 260, tol = 0.012 } = {}): Treemap {
  const n = items.length;
  const total = Math.abs(polyArea(B));
  const sum = items.reduce((s, it) => s + it.target, 0);
  const T = items.map((it) => (it.target / sum) * total);
  const S: Vec2[] = items.map((it) => [it.site[0], it.site[1]]);
  const R = T.map((t) => Math.sqrt(t / Math.PI));
  const W = R.map((r) => r * r);
  let cells = powerCells(B, S, W);
  let err = Infinity;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      if (items[i]!.pin) continue;
      if (cells[i]!.length) S[i] = polyCentroid(cells[i]!);
    }
    cells = powerCells(B, S, W);
    err = 0;
    for (let i = 0; i < n; i++) {
      const a = cells[i]!.length ? Math.abs(polyArea(cells[i]!)) : 0;
      err = Math.max(err, Math.abs(a - T[i]!) / T[i]!);
      // Area grows roughly with the square of the radius, so the radius moves by the square root of the ratio.
      const f = Math.min(1.35, Math.max(0.74, Math.sqrt(T[i]! / Math.max(a, T[i]! * 0.02))));
      let nn = Infinity;
      for (let j = 0; j < n; j++) if (j !== i) nn = Math.min(nn, Math.hypot(S[i]![0] - S[j]![0], S[i]![1] - S[j]![1]));
      R[i] = Math.max(1e-6, Math.min(R[i]! * f, nn));
      W[i] = R[i]! * R[i]!;
    }
    cells = powerCells(B, S, W);
    if (err < tol) break;
  }
  return { cells, sites: S, weights: W, targets: T, err, iter };
}

/** n start positions inside B: a sunflower spiral around the incircle centre. */
export function spiralSites(B: readonly Vec2[], n: number, phase = 0): Vec2[] {
  const { c } = incircle(B);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = phase + i * GOLDEN;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const u = 0.82 * Math.sqrt((i + 0.5) / n);
    const r = reach(B, c, dx, dy) * u;
    return [c[0] + dx * r, c[1] + dy * r];
  });
}
