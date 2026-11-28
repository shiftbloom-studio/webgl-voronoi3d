// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The turntable: view state, where a world point lands on screen, and where a screen point meets the canopy plane.

import { type Basis, fitZoom, viewBasis } from "../core/camera.js";
import type { Vec2 } from "../core/geometry.js";
import type { Inset, Params } from "../core/types.js";

export interface View {
  azimuth: number;
  /** Radians off the vertical, 0..maxTilt. */
  tilt: number;
  /** 1 = the whole grove fits the safe rectangle; at most 12. */
  zoom: number;
  /** Pan, in world units along the screen axes (right, up). Only above zoom 1. */
  center: Vec2;
}

export const DEFAULT_VIEW: View = { azimuth: -0.6, tilt: 0.8, zoom: 1, center: [0, 0] };
export const MAX_ZOOM = 12;

export interface Screen {
  width: number;
  height: number;
  inset: Inset;
}

export interface Projection {
  basis: Basis;
  /** px per world unit. */
  z: number;
  /** Screen offset of the world origin from the top left corner, before the basis is applied. */
  ox: number;
  oy: number;
}

const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

export function safeRect(s: Screen) {
  const i = s.inset ?? NO_INSET;
  return { x: i.left, y: i.top, w: Math.max(1, s.width - i.left - i.right), h: Math.max(1, s.height - i.top - i.bottom) };
}

/** Keeps a view inside its limits: tilt within [0, maxTilt], zoom within [1, 12], pan so the bed stays in the safe rectangle. */
export function clampView(v: View, p: Pick<Params, "maxTilt" | "bedRadius">): View {
  const tilt = Math.min(p.maxTilt, Math.max(0, v.tilt));
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const lim = p.bedRadius * (1 - 1 / zoom);
  const center: Vec2 = [Math.min(lim, Math.max(-lim, v.center[0])), Math.min(lim, Math.max(-lim, v.center[1]))];
  return { azimuth: v.azimuth, tilt, zoom, center };
}

export function projection(v: View, s: Screen, p: Params): Projection {
  const safe = safeRect(s);
  const z = fitZoom({ width: safe.w, height: safe.h }, v.tilt, p) * v.zoom;
  // The grove (canopy and ground together) is centred in the safe rectangle; the ground hangs trunk * sin(tilt) below.
  const ox = safe.x + safe.w / 2 + v.center[0] * z;
  const oy = safe.y + safe.h / 2 - (p.trunk * Math.sin(v.tilt) * z) / 2 - v.center[1] * z;
  return { basis: viewBasis(v.azimuth, v.tilt), z, ox, oy };
}

/** World (x, height, z) to screen px (y down). */
export function toScreen(pr: Projection, x: number, y: number, z: number): Vec2 {
  const b = pr.basis;
  const r = x * b.right[0] + y * b.right[1] + z * b.right[2];
  const u = x * b.up[0] + y * b.up[1] + z * b.up[2];
  return [pr.ox + r * pr.z, pr.oy - u * pr.z];
}

/** Screen px to the plan point where the view ray meets the canopy plane (height 0). */
export function toPlan(pr: Projection, sx: number, sy: number): Vec2 {
  const b = pr.basis;
  const r = (sx - pr.ox) / pr.z;
  const u = -(sy - pr.oy) / pr.z;
  // r = x*right.x + z*right.z, u = x*up.x + z*up.z (height 0)
  const det = b.right[0] * b.up[2] - b.right[2] * b.up[0];
  return [(r * b.up[2] - u * b.right[2]) / det, (u * b.right[0] - r * b.up[0]) / det];
}

/** The view after zooming by `factor` with the screen point (sx, sy) kept in place. */
export function zoomAt(v: View, s: Screen, p: Params, factor: number, sx: number, sy: number): View {
  const pr = projection(v, s, p);
  const next = clampView({ ...v, zoom: v.zoom * factor }, p);
  const pr2 = projection({ ...next, center: [0, 0] }, s, p);
  // World coordinates (along right/up) of the point under the pointer stay put.
  const r = (sx - pr.ox) / pr.z;
  const u = -(sy - pr.oy) / pr.z;
  const cx = (sx - pr2.ox) / pr2.z - r;
  const cy = -(sy - pr2.oy) / pr2.z - u;
  return clampView({ ...next, center: [cx, cy] }, p);
}

/** The view that puts world point (x, h, z) at the centre of the safe rectangle at the given zoom. */
export function viewOn(v: View, s: Screen, p: Params, x: number, h: number, z: number, zoom: number): View {
  const next = clampView({ ...v, zoom, center: [0, 0] }, p);
  const b = viewBasis(next.azimuth, next.tilt);
  const r = x * b.right[0] + h * b.right[1] + z * b.right[2];
  const u = x * b.up[0] + h * b.up[1] + z * b.up[2];
  // ox + r*z must be the safe centre: center[0] = -r; oy - u*z likewise, with the ground offset.
  return clampView({ ...next, center: [-r, -u - (p.trunk * Math.sin(next.tilt)) / 2] }, p);
}
