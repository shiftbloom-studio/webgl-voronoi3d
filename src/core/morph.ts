// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One frame of the morph between two layouts (spec 3.9). Sites and power weights are interpolated and
// the cells, hearts and crowns are recomputed from them, so every frame is a real partition with real
// crowns and the occlusion guarantee holds mid-flight. Leaves do not ride along.

import { crown, type Crown } from "./crown.js";
import { type Polygon, type Vec2, incircle, insetPoly, polyArea, powerCells } from "./geometry.js";
import type { CanopyLayout, HeartLayout, RegionLayout } from "./types.js";

export interface FrameRegion {
  id: string;
  label: string;
  caption: string | undefined;
  poly: Polygon;
  tone: number;
  titleSize: { width: number; height: number };
  heart: HeartLayout;
  tufts: string[];
}

export interface FrameTuft {
  id: string;
  region: string;
  label: string;
  poly: Polygon;
  crown: Crown;
  labelSize: { width: number; height: number } | null;
  tableRadius: number;
}

export interface CanopyFrame {
  /** 0 = layout a, 1 = layout b. */
  k: number;
  regions: FrameRegion[];
  tufts: FrameTuft[];
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Power weights are squared radii (and never negative here); the radius is what moves linearly. */
const lerpWeight = (a: number, b: number, k: number) => lerp(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, b)), k) ** 2;

/** A layout as a frame: what the renderer draws when nothing is moving. */
export function frameOf(layout: CanopyLayout, k = 0): CanopyFrame {
  return {
    k,
    regions: layout.regions.map((r) => ({ id: r.id, label: r.label, caption: r.caption, poly: r.poly, tone: r.tone, titleSize: r.titleSize, heart: r.heart, tufts: r.tufts })),
    tufts: layout.tufts.map((t) => ({ id: t.id, region: t.region, label: t.label, poly: t.poly, crown: t.crown, labelSize: t.labelSize, tableRadius: t.tableRadius })),
  };
}

const sameRegions = (a: CanopyLayout, b: CanopyLayout) => a.regions.length === b.regions.length && a.regions.every((r, i) => r.id === b.regions[i]!.id);
const sameTufts = (a: RegionLayout, b: RegionLayout) => a.sub.ids.length === b.sub.ids.length && a.sub.ids.every((id, i) => id === b.sub.ids[i]);

/**
 * Cells and crowns for morph position k in [0, 1]. Layouts with a different set of regions (grouping
 * changed) cannot be blended and jump at k = 0.5; so does a single region whose topics changed.
 */
export function interpolateLayout(a: CanopyLayout, b: CanopyLayout, k: number): CanopyFrame {
  const t = Math.min(1, Math.max(0, k));
  if (t === 0) return frameOf(a, 0);
  if (t === 1) return frameOf(b, 1);
  if (!sameRegions(a, b)) return frameOf(t < 0.5 ? a : b, t);
  const p = b.params;

  const ids = a.regions.map((r) => r.id);
  const sites = ids.map((id): Vec2 => [lerp(a.sites[id]![0], b.sites[id]![0], t), lerp(a.sites[id]![1], b.sites[id]![1], t)]);
  const weights = ids.map((id) => lerpWeight(a.weights[id]!, b.weights[id]!, t));
  // Lerped weights alone can squeeze a small cell below both of its end sizes mid-flight. A few weight-only
  // steps (sites stay on their lerped path) pull every cell to the lerped area, so no heart gets too small for its title.
  const areaA = a.regions.map((r) => Math.abs(polyArea(r.cell)));
  const areaB = b.regions.map((r) => Math.abs(polyArea(r.cell)));
  const cells = fitWeights(
    b.bed,
    sites,
    weights,
    areaA.map((x, i) => lerp(x, areaB[i]!, t)),
  );
  const tuftA = new Map(a.tufts.map((x) => [x.id, x]));
  const tuftB = new Map(b.tufts.map((x) => [x.id, x]));

  const regions: FrameRegion[] = [];
  const tufts: FrameTuft[] = [];
  ids.forEach((id, i) => {
    const ra = a.regions[i]!;
    const rb = b.regions[i]!;
    const poly = insetPoly(cells[i]!, p.gapRegion / 2);
    if (poly.length < 3) return;
    const circle = incircle(poly);
    const base = { id, label: rb.label, caption: rb.caption, poly, tone: rb.tone, titleSize: rb.titleSize };

    if (!sameTufts(ra, rb)) {
      // The topics changed: the region moves with the frame, its inside jumps halfway.
      const src = t < 0.5 ? ra : rb;
      const from = t < 0.5 ? a : b;
      const sub = place(src, circle.c, circle.r, src.sub.sites, src.sub.weights);
      fitSub(sub, poly, shares(src), src.titleDisc, p.gapTuft);
      tufts.push(...subTufts(src, sub, poly, from === a ? tuftA : tuftB, (j) => src.sub.tableRadius[j]!, p));
      regions.push({ ...base, heart: heartOf(sub, poly, p.gapTuft), tufts: src.tufts });
      return;
    }

    // The sub-diagram is carried in the region's own frame (centre and radius of its incircle), so it scales and moves with the cell.
    const na = normalise(ra);
    const nb = normalise(rb);
    const subSites = na.sites.map((s, j): Vec2 => [lerp(s[0], nb.sites[j]![0], t), lerp(s[1], nb.sites[j]![1], t)]);
    const subWeights = na.weights.map((w, j) => lerpWeight(w, nb.weights[j]!, t));
    const sub = place(null, circle.c, circle.r, subSites, subWeights);
    const sa = shares(ra);
    const sb = shares(rb);
    fitSub(
      sub,
      poly,
      sa.map((x, j) => lerp(x, sb[j]!, t)),
      Math.max(ra.titleDisc, rb.titleDisc),
      p.gapTuft,
    );
    tufts.push(...subTufts(rb, sub, poly, tuftB, (j) => lerp(ra.sub.tableRadius[j]!, rb.sub.tableRadius[j]!, t), p));
    regions.push({ ...base, heart: heartOf(sub, poly, p.gapTuft), tufts: rb.tufts });
  });
  return { k: t, regions, tufts };
}

/** Share of the region's area that each cell of its sub-diagram has in the layout. */
const shareCache = new WeakMap<RegionLayout, number[]>();
function shares(r: RegionLayout): number[] {
  let out = shareCache.get(r);
  if (!out) {
    const total = Math.abs(polyArea(r.poly));
    out = powerCells(r.poly, r.sub.sites, r.sub.weights).map((c) => (c.length ? Math.abs(polyArea(c)) : 0) / total);
    shareCache.set(r, out);
  }
  return out;
}

/**
 * Pulls the sub-diagram to the interpolated area shares, then grows the heart until it holds its title
 * disc again, so a title fits its heart on every frame, not just at both ends.
 */
function fitSub(sub: Placed & { cells?: Polygon[] }, poly: Polygon, share: number[], titleDisc: number, gap: number) {
  const area = Math.abs(polyArea(poly));
  const T = share.map((x) => Math.max(x, 1e-4) * area);
  sub.cells = fitWeights(poly, sub.sites, sub.weights, T);
  for (let round = 0; round < 16; round++) {
    const hp = insetPoly(sub.cells[0]!, gap / 2);
    if (hp.length >= 3 && incircle(hp).r >= titleDisc) return;
    // Take the heart's extra area from the tufts, in proportion to their size.
    const grow = T[0]! * 0.08;
    const rest = T.slice(1).reduce((x, y) => x + y, 0);
    T[0]! += grow;
    for (let j = 1; j < T.length; j++) T[j]! -= (grow * T[j]!) / rest;
    sub.cells = fitWeights(poly, sub.sites, sub.weights, T);
  }
}

/** Sub sites and weights relative to the region's incircle: unit radius at the origin. */
function normalise(r: RegionLayout): { sites: Vec2[]; weights: number[] } {
  const s = Math.max(r.r, 1e-9);
  return { sites: r.sub.sites.map((v): Vec2 => [(v[0] - r.c[0]) / s, (v[1] - r.c[1]) / s]), weights: r.sub.weights.map((w) => w / (s * s)) };
}

interface Placed {
  sites: Vec2[];
  weights: number[];
}

/** Maps normalised sub sites into a circle (or, with `from`, moves absolute ones from that region's circle). */
function place(from: RegionLayout | null, c: Vec2, r: number, sites: Vec2[], weights: number[]): Placed {
  const n = from ? normalise({ ...from, sub: { ...from.sub, sites, weights } }) : { sites, weights };
  return { sites: n.sites.map((v): Vec2 => [c[0] + v[0] * r, c[1] + v[1] * r]), weights: n.weights.map((w) => w * r * r) };
}

function heartOf(sub: Placed & { cells?: Polygon[] }, poly: Polygon, gap: number): HeartLayout {
  const cells = sub.cells ?? powerCells(poly, sub.sites, sub.weights);
  sub.cells = cells;
  const hp = insetPoly(cells[0]!, gap / 2);
  if (hp.length < 3) return { c: incircle(poly).c, r: 0, poly: [] };
  const h = incircle(hp);
  return { c: h.c, r: h.r, poly: hp };
}

function subTufts(
  r: RegionLayout,
  sub: Placed & { cells?: Polygon[] },
  poly: Polygon,
  tuftsById: Map<string, CanopyLayout["tufts"][number]>,
  tableRadius: (j: number) => number,
  p: CanopyLayout["params"],
): FrameTuft[] {
  const cells = sub.cells ?? powerCells(poly, sub.sites, sub.weights);
  sub.cells = cells;
  const out: FrameTuft[] = [];
  for (let s = 1; s < cells.length; s++) {
    const src = tuftsById.get(r.sub.ids[s] ?? "");
    // A topic whose cell was empty in the layout has no tuft.
    if (!src) continue;
    const tp = insetPoly(cells[s]!, p.gapTuft / 2);
    if (tp.length < 3) continue;
    const tr = tableRadius(s);
    out.push({ id: src.id, region: r.id, label: src.label, poly: tp, crown: crown(tp, p.slope, tr, p), labelSize: src.labelSize, tableRadius: tr });
  }
  return out;
}

/** Weight-only treemap steps with fixed sites: cells move toward their target areas. Changes `W` in place. */
function fitWeights(B: Polygon, S: Vec2[], W: number[], T: number[], iterations = 8): Polygon[] {
  let cells = powerCells(B, S, W);
  const R = W.map((w) => Math.sqrt(Math.max(w, 0)));
  for (let it = 0; it < iterations; it++) {
    let worst = 0;
    for (let i = 0; i < S.length; i++) {
      const area = cells[i]!.length ? Math.abs(polyArea(cells[i]!)) : 0;
      worst = Math.max(worst, Math.abs(area - T[i]!) / T[i]!);
      const f = Math.min(1.2, Math.max(0.83, Math.sqrt(T[i]! / Math.max(area, T[i]! * 0.02))));
      R[i] = Math.max(1e-6, R[i]! * f);
      W[i] = R[i]! * R[i]!;
    }
    if (worst < 0.01) break;
    cells = powerCells(B, S, W);
  }
  return cells;
}
