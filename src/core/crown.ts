// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Crowns (hip roofs over convex cells) and the leaf slots on their sloped sides.

import { type Edge, type Polygon, type Vec2, clipHalf, incircle, insetOf, insetPoly, polyArea, polyEdges } from "./geometry.js";

/** The part of a hip roof that rises from one rim side: a plane with exactly `slope`. */
export interface Facet extends Edge {
  /** Unit vector along the rim side. */
  tx: number;
  ty: number;
  /** Rise per plan unit away from the rim (tan of the crown slope). */
  slope: number;
  /** The face in plan: a convex polygon. */
  poly: Polygon;
  index: number;
}

export interface Crown {
  P: Polygon;
  c: Vec2;
  r: number;
  /** Width of the sloped ring: the table starts this far in from the rim. */
  d0: number;
  tan: number;
  height: number;
  table: Polygon;
  /** Inradius of the table (r - d0). */
  tableRadius: number;
  facets: Facet[];
}

export interface CrownOptions {
  /** Sloped ring as a share of the inradius, at least and at most; the table gets the rest. */
  minRing?: number;
  maxRing?: number;
}

/**
 * A crown over the convex cell P: a hip roof. Height = tan(slope) x distance to the rim, capped where the
 * flat table starts. Every face has exactly `slope`, and the table is the cell moved inward, so it holds a
 * disc of `tableRadius` around the incircle centre however long and thin the cell is.
 * facets[j] is the part of the roof that rises from one rim side; a side whose face is empty has none.
 */
export function crown(P: Polygon, slopeRad: number, tableRadius: number, { minRing = 0.25, maxRing = 0.86 }: CrownOptions = {}): Crown {
  const { c, r } = incircle(P);
  const d0 = Math.min(maxRing * r, Math.max(minRing * r, r - tableRadius));
  const tan = Math.tan(slopeRad);
  const edges = polyEdges(P);
  const facets: Facet[] = [];
  edges.forEach((e, j) => {
    const dj = e.nx * e.a[0] + e.ny * e.a[1];
    // Not past the table, and closer to side j than to any other side.
    let F = clipHalf(P, e.nx, e.ny, dj + d0);
    for (let k = 0; k < edges.length && F.length; k++) {
      if (k === j) continue;
      const o = edges[k]!;
      F = clipHalf(F, e.nx - o.nx, e.ny - o.ny, dj - (o.nx * o.a[0] + o.ny * o.a[1]));
    }
    if (F.length && Math.abs(polyArea(F)) > 1e-9) facets.push({ ...e, tx: (e.b[0] - e.a[0]) / e.len, ty: (e.b[1] - e.a[1]) / e.len, slope: tan, poly: F, index: facets.length });
  });
  return { P, c, r, d0, tan, height: tan * d0, table: insetPoly(P, d0), tableRadius: r - d0, facets };
}

/** Height of the crown surface above the plan point p. */
export function crownHeight(cr: Crown, p: Vec2): number {
  return cr.tan * Math.max(0, Math.min(cr.d0, insetOf(cr.P, p)));
}

export interface LeafSlot {
  p: Vec2;
  facet: number;
  row: number;
  /** Leaf ellipse: `a` long (up the slope), `b` wide, in plan units. */
  a: number;
  b: number;
}

export interface LeafOptions {
  aspect?: number;
  fill?: number;
}

/**
 * Slots for leaves on the sloped faces of a crown, in rows parallel to the rim, like roof tiles.
 * A slot is kept only if the whole leaf ellipse lies inside its face, so leaves are disjoint patches of
 * the crown surface and can never overlap on screen. Sorted from the table outward.
 */
export function leafSlots(cr: Crown, pitch: number, { aspect = 1.45, fill = 0.9 }: LeafOptions = {}): LeafSlot[] {
  const pr = pitch * aspect;
  const pt = pitch;
  const a = pr * fill;
  const b = pt * fill;
  const slots: LeafSlot[] = [];
  for (const f of cr.facets) {
    const fe = polyEdges(f.poly);
    for (let m = 0; ; m++) {
      // Row 0 is next to the table.
      const delta = cr.d0 - (m + 0.5) * pr - pr * 0.08;
      if (delta < a / 2) break;
      const ox = f.a[0] + f.nx * delta;
      const oy = f.a[1] + f.ny * delta;
      // The stretch of this row that lies inside the face.
      let s0 = -Infinity;
      let s1 = Infinity;
      for (const e of fe) {
        const base = e.nx * (ox - e.a[0]) + e.ny * (oy - e.a[1]);
        const rate = e.nx * f.tx + e.ny * f.ty;
        if (Math.abs(rate) < 1e-12) {
          if (base < 0) [s0, s1] = [1, 0];
          continue;
        }
        if (rate > 0) s0 = Math.max(s0, -base / rate);
        else s1 = Math.min(s1, -base / rate);
      }
      if (!(s1 > s0)) continue;
      const count = Math.floor((s1 - s0) / pt);
      const start = s0 + (s1 - s0 - (count - 1) * pt) / 2 + (m % 2 ? pt * 0.25 : -pt * 0.25);
      for (let k = 0; k < count; k++) {
        const sk = start + k * pt;
        const p: Vec2 = [ox + f.tx * sk, oy + f.ty * sk];
        let ok = true;
        for (const e of fe) {
          const dist = e.nx * (p[0] - e.a[0]) + e.ny * (p[1] - e.a[1]);
          // Half-width of the ellipse measured across this side of the face.
          const support = Math.hypot((a / 2) * (e.nx * f.nx + e.ny * f.ny), (b / 2) * (e.nx * f.tx + e.ny * f.ty));
          if (dist < support * 1.06 + pitch * 0.03) {
            ok = false;
            break;
          }
        }
        if (ok) slots.push({ p, facet: f.index, row: m, a, b });
      }
    }
  }
  slots.sort((x, y) => x.row - y.row || x.facet - y.facet);
  return slots;
}

/** The largest pitch at which the crown still has room for n leaves. */
export function fitPitch(cr: Crown, n: number, opts?: LeafOptions): { pitch: number; slots: LeafSlot[] } {
  if (n <= 0) return { pitch: cr.r, slots: [] };
  const ring = Math.abs(polyArea(cr.P)) - (cr.table.length ? Math.abs(polyArea(cr.table)) : 0);
  const guess = Math.sqrt(ring / (n * (opts?.aspect ?? 1.45)));
  let lo = guess * 0.25;
  let hi = guess * 1.3;
  while (leafSlots(cr, lo, opts).length < n && lo > guess * 0.01) lo *= 0.6;
  while (leafSlots(cr, hi, opts).length >= n && hi < cr.r * 2) {
    lo = hi;
    hi *= 1.4;
  }
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (leafSlots(cr, mid, opts).length >= n) lo = mid;
    else hi = mid;
  }
  return { pitch: lo, slots: leafSlots(cr, lo, opts) };
}
