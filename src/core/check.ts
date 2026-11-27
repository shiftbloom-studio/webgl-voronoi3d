// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checks every guarantee of a layout over a sweep of permitted camera views. Ships in the package so
// consumers can assert it in their own tests: an empty list means nothing can hide anything else.

import { DEG, type Basis, dropToPlane, fitZoom, project, viewBasis } from "./camera.js";
import { crownHeight } from "./crown.js";
import { type Polygon, type Vec2, contains, insetOf, intersectionArea, polyArea } from "./geometry.js";
import type { CanopyFrame } from "./morph.js";
import type { CanopyLayout, HeartLayout, LeafLayout, Params, TuftLayout, Viewport } from "./types.js";

export type ViolationKind = "cellOverlap" | "crownEscapes" | "leafEscapes" | "leafOverlap" | "labelEscapes" | "labelOverlap" | "topicLabelEscapes" | "droppedLeaves";

export interface Violation {
  kind: ViolationKind;
  id: string;
  view?: CheckView;
}

export interface CheckView {
  azimuth: number;
  tilt: number;
}

/** 12 azimuths x tilts {0, 20, 35, 45, maxTilt}. */
export function defaultViews(maxTilt: number): CheckView[] {
  const views: CheckView[] = [];
  for (let ai = 0; ai < 12; ai++) {
    for (const t of [0, 20 * DEG, 35 * DEG, 45 * DEG, maxTilt]) if (t <= maxTilt) views.push({ azimuth: (ai / 12) * Math.PI * 2 + 0.13, tilt: t });
  }
  return views;
}

/** Title scale used by the renderer: it grows with its heart, from 1 to 1.7. */
export function titleScale(heartR: number, zoomPx: number, w: number, h: number, tilt: number): number {
  return Math.min(1.7, Math.max(1, (heartR * zoomPx * 0.97) / Math.hypot(w / 2, h / (2 * Math.cos(tilt)))));
}

/** 14 points on the rim of a leaf ellipse, lying on its facet, in world coordinates (x, height, z). */
export function leafRing(tuft: TuftLayout, lf: LeafLayout, n = 14): [number, number, number][] {
  const f = tuft.crown.facets[lf.facet]!;
  const tx = (f.b[0] - f.a[0]) / f.len;
  const ty = (f.b[1] - f.a[1]) / f.len;
  return Array.from({ length: n }, (_, k) => {
    const an = (k / n) * Math.PI * 2;
    const u = (Math.cos(an) * lf.a) / 2;
    const v = (Math.sin(an) * lf.b) / 2;
    return [lf.p[0] + f.nx * u + tx * v, lf.y + f.slope * u, lf.p[1] + f.ny * u + ty * v];
  });
}

const ccw = (P: Polygon): Polygon => (polyArea(P) < 0 ? [...P].reverse() : P);
const corners = (c: Vec2, w: number, h: number): Vec2[] => [
  [c[0] - w / 2, c[1] - h / 2],
  [c[0] + w / 2, c[1] - h / 2],
  [c[0] + w / 2, c[1] + h / 2],
  [c[0] - w / 2, c[1] + h / 2],
];

/** `expectedNodes` defaults to every node the layout was given a region for, so a dropped leaf is always reported. */
export function checkGuarantees(layout: CanopyLayout, views: CheckView[] = defaultViews(layout.params.maxTilt), expectedNodes: number = Object.keys(layout.nodeRegion).length): Violation[] {
  const out: Violation[] = [];
  const { tufts, regions, params: p } = layout;

  cellChecks(tufts, regions, out);
  const placed = tufts.reduce((s, t) => s + t.leaves.length, 0);
  if (placed < expectedNodes) out.push({ kind: "droppedLeaves", id: String(expectedNodes - placed) });

  for (const view of views) {
    const basis = viewBasis(view.azimuth, view.tilt);
    const zoom = fitZoom(layout.viewport, view.tilt, p);
    checkView(layout, basis, zoom, view, out);
  }
  return out;
}

interface CellLike {
  id: string;
  poly: Polygon;
}
interface TuftLike extends CellLike {
  crown: TuftLayout["crown"];
}
interface RegionLike extends CellLike {
  heart: HeartLayout;
  titleSize: { width: number; height: number };
}

function cellChecks(tufts: readonly CellLike[], regions: readonly CellLike[], out: Violation[]) {
  for (const list of [tufts, regions]) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) if (intersectionArea(list[i]!.poly, list[j]!.poly) > 1e-7) out.push({ kind: "cellOverlap", id: `${list[i]!.id}|${list[j]!.id}` });
    }
  }
}

/**
 * The guarantees that hold on every frame of a morph: cells are disjoint, crowns stay over their cell,
 * titles sit inside their heart and apart. Leaves are not part of a frame.
 */
export function checkFrame(frame: CanopyFrame, layout: { params: Params; viewport: Viewport }, views: CheckView[] = defaultViews(layout.params.maxTilt)): Violation[] {
  const out: Violation[] = [];
  cellChecks(frame.tufts, frame.regions, out);
  for (const view of views) {
    const basis = viewBasis(view.azimuth, view.tilt);
    const zoom = fitZoom(layout.viewport, view.tilt, layout.params);
    crownChecks(frame.tufts, basis, view, out);
    titleChecks(frame.regions, basis, zoom, view, out);
  }
  return out;
}

const pxOf =
  (basis: Basis, zoom: number) =>
  (x: number, y: number, z: number): Vec2 => {
    const s = project(basis, x, y, z);
    return [s[0] * zoom, s[1] * zoom];
  };

function checkView(layout: CanopyLayout, basis: Basis, zoom: number, view: CheckView, out: Violation[]) {
  const px = pxOf(basis, zoom);
  crownChecks(layout.tufts, basis, view, out);
  leafChecks(layout, basis, zoom, px, view, out);
  titleChecks(layout.regions, basis, zoom, view, out);
  topicChecks(layout, basis, zoom, view, out);
}

function crownChecks(tufts: readonly TuftLike[], basis: Basis, view: CheckView, out: Violation[]) {
  // Crowns stay over their own cell.
  for (const t of tufts) {
    const cr = t.crown;
    let escaped = false;
    for (const v of cr.table) if (!contains(t.poly, dropToPlane(basis, v[0], cr.height, v[1]), 1e-6)) escaped = true;
    for (let k = 0; k < 24 && !escaped; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = cr.r * (0.2 + (0.75 * ((k * 7) % 10)) / 10);
      const q: Vec2 = [cr.c[0] + Math.cos(a) * rr, cr.c[1] + Math.sin(a) * rr];
      if (insetOf(t.poly, q) < 0) continue;
      if (!contains(t.poly, dropToPlane(basis, q[0], crownHeight(cr, q), q[1]), 1e-6)) escaped = true;
    }
    if (escaped) out.push({ kind: "crownEscapes", id: t.id, view });
  }
}

function leafChecks(layout: CanopyLayout, basis: Basis, zoom: number, px: (x: number, y: number, z: number) => Vec2, view: CheckView, out: Violation[]) {
  // Leaves: inside their own cell on screen, never on top of each other.
  const shapes: { scr: Polygon; c: Vec2; id: string }[] = [];
  let maxLeaf = 0;
  for (const t of layout.tufts) {
    for (const lf of t.leaves) {
      const ring = leafRing(t, lf);
      if (ring.some((q) => !contains(t.poly, dropToPlane(basis, q[0], q[1], q[2]), 1e-6))) out.push({ kind: "leafEscapes", id: lf.node, view });
      shapes.push({ scr: ccw(ring.map((q) => px(q[0], q[1], q[2]))), c: px(lf.p[0], lf.y, lf.p[1]), id: lf.node });
      maxLeaf = Math.max(maxLeaf, lf.a, lf.b);
    }
  }
  const cell = Math.max(4, maxLeaf * zoom * 1.2);
  const grid = new Map<string, number[]>();
  shapes.forEach((s, i) => {
    const key = `${Math.floor(s.c[0] / cell)},${Math.floor(s.c[1] / cell)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  shapes.forEach((s, i) => {
    const gx = Math.floor(s.c[0] / cell);
    const gy = Math.floor(s.c[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (j <= i) continue;
          if (intersectionArea(s.scr, shapes[j]!.scr) > 1e-4) out.push({ kind: "leafOverlap", id: `${s.id}|${shapes[j]!.id}`, view });
        }
      }
    }
  });
}

function titleChecks(regions: readonly RegionLike[], basis: Basis, zoom: number, view: CheckView, out: Violation[]) {
  const px = pxOf(basis, zoom);
  // Titles: inside their heart at the scale the renderer uses, apart from each other.
  const rects: { id: string; r: [number, number, number, number] }[] = [];
  for (const r of regions) {
    const h = r.heart;
    if (h.poly.length < 3) {
      out.push({ kind: "labelEscapes", id: r.id, view });
      continue;
    }
    const s = titleScale(h.r, zoom, r.titleSize.width, r.titleSize.height, view.tilt);
    const w = r.titleSize.width * s;
    const hh = r.titleSize.height * s;
    const c = px(h.c[0], 0, h.c[1]);
    const scr = ccw(h.poly.map((v) => px(v[0], 0, v[1])));
    if (corners(c, w, hh).some((q) => !contains(scr, q, 1e-6))) out.push({ kind: "labelEscapes", id: r.id, view });
    rects.push({ id: r.id, r: [c[0] - w / 2, c[1] - hh / 2, c[0] + w / 2, c[1] + hh / 2] });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!.r;
      const b = rects[j]!.r;
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) out.push({ kind: "labelOverlap", id: `${rects[i]!.id}|${rects[j]!.id}`, view });
    }
  }
}

function topicChecks(layout: CanopyLayout, basis: Basis, zoom: number, view: CheckView, out: Violation[]) {
  // Topic names: from their label zoom on, on their own table.
  for (const t of layout.tufts) {
    if (!t.label || !t.labelSize || !Number.isFinite(t.labelZoom)) continue;
    const cr = t.crown;
    const z2 = zoom * Math.max(1, t.labelZoom) * 1.0001;
    const c = project(basis, cr.c[0], cr.height, cr.c[1]).map((v) => v * z2) as Vec2;
    const scr = ccw(cr.table.map((v) => project(basis, v[0], cr.height, v[1]).map((x) => x * z2) as Vec2));
    if (corners(c, t.labelSize.width, t.labelSize.height).some((q) => !contains(scr, q, 1e-6))) out.push({ kind: "topicLabelEscapes", id: t.id, view });
  }
}
