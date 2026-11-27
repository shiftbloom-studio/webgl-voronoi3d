// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Crown } from "./crown.js";
import type { Polygon, Vec2 } from "./geometry.js";

export interface RegionInput {
  id: string;
  /** null or absent = top level. Two levels are laid out. */
  parent?: string | null;
  /** Shown in the cell; the full text also goes to the accessibility tree. */
  label: string;
  /** Second line of a top-level title, e.g. "214 notes". */
  caption?: string;
  /** Extra area share. Default: the number of nodes inside. */
  weight?: number;
  /** Top level only: keep at the centre of the bed. */
  pin?: boolean;
}

export interface NodeInput {
  id: string;
  /** A leaf region (or a top-level region without children). */
  region: string;
  label?: string;
  /** 0..1; higher sits closer to the table and gets a label first. */
  rank?: number;
  shape?: "leaf" | "diamond" | "seed";
  /** CSS colour; default theme leaf colour. */
  color?: string;
  /** Any monotonic number (ms); used by the time dial. */
  t?: number;
  state?: "normal" | "muted" | "fallen";
}

export interface HubInput {
  id: string;
  label: string;
  weight?: number;
  regions: string[];
}

export interface LinkInput {
  source: string;
  target: string;
  weight?: number;
  kind?: string;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** What panels cover; the grove fits the rest. */
  inset?: Inset;
}

export type LabelRole = "title" | "caption" | "topic" | "node" | "hub";
export type Measure = (text: string, role: LabelRole) => { width: number; height: number };

export interface Params {
  bedRadius: number;
  /** Radians: the camera never tilts further than this from the vertical. */
  maxTilt: number;
  /** Radians: the steepest side of any crown. slope + maxTilt must stay below 90°. */
  slope: number;
  gapRegion: number;
  gapTuft: number;
  trunk: number;
  skirt: number;
  /** Zoom (x overview) from which topic names are promised outside the lens. */
  focusZoom: number;
  focusShare: number;
  /** Sloped ring of a crown as a share of its inradius, at least and at most; the table gets the rest. */
  minRing: number;
  maxRing: number;
  leafAspect: number;
  leafFill: number;
}

export interface LayoutOptions {
  focus?: string | null;
  /** Area multiplier per top-level region id, e.g. from search hits. */
  areaBoost?: Map<string, number>;
  /** Warm start: regions keep their place. */
  previous?: CanopyLayout | { sites: Record<string, Vec2> } | null;
  params?: Partial<Params>;
  /** Label of the group region that collects small regions when the viewport cannot hold every title. */
  more?: (count: number) => string;
}

export interface LeafLayout {
  node: string;
  tuft: string;
  p: Vec2;
  /** Height on the crown. */
  y: number;
  facet: number;
  a: number;
  b: number;
}

export interface TuftLayout {
  id: string;
  region: string;
  label: string;
  poly: Polygon;
  crown: Crown;
  /** Zoom (x overview) from which the label fits on the table. Infinity for unnamed tufts. */
  labelZoom: number;
  labelSize: { width: number; height: number } | null;
  tableRadius: number;
  leaves: LeafLayout[];
}

export interface HeartLayout {
  c: Vec2;
  r: number;
  poly: Polygon;
}

export interface RegionLayout {
  id: string;
  label: string;
  caption: string | undefined;
  /** Power cell before the gap inset (corridors run along these edges). */
  cell: Polygon;
  poly: Polygon;
  c: Vec2;
  r: number;
  tone: number;
  count: number;
  titleSize: { width: number; height: number };
  titleDisc: number;
  heart: HeartLayout;
  tufts: string[];
  /** Ids of the regions merged into this one when it is a group (3.8). */
  members: string[] | null;
  /** Sub-diagram inside the region: site 0 is the heart, site k + 1 the k-th topic (`ids`). Kept for the morph. */
  sub: { ids: (string | null)[]; sites: Vec2[]; weights: number[]; tableRadius: number[] };
}

export interface CanopyLayout {
  params: Params;
  viewport: Viewport;
  bed: Polygon;
  regions: RegionLayout[];
  tufts: TuftLayout[];
  /** Top-level sites and power weights, by region order. */
  sites: Record<string, Vec2>;
  weights: Record<string, number>;
  /** Node id -> region id it was placed in (after grouping). */
  nodeRegion: Record<string, string>;
  focus: string | null;
  areaError: number;
}
