// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The orthographic turntable and the rule that makes the canopy occlusion-free.

import type { Vec2 } from "./geometry.js";
import type { Params, Viewport } from "./types.js";

export const DEG = Math.PI / 180;

/**
 * The one condition everything rests on. A crown is a height field over its cell that is 0 on the
 * rim and nowhere steeper than `slope`. Seen from at most `maxTilt` off the vertical (orthographic),
 * each crown projects one-to-one onto the screen and stays over its own cell as long as
 * slope + maxTilt < 90°. Cells tile the plane, so no crown can cover another.
 */
export function guaranteeHolds(slopeRad: number, maxTiltRad: number): boolean {
  return slopeRad > 0 && maxTiltRad >= 0 && slopeRad + maxTiltRad < Math.PI / 2 - 1e-9;
}

/** How much the far side of a crown is squashed on screen at the steepest view (1 = not at all). */
export function worstSquash(slopeRad: number, maxTiltRad: number): number {
  return Math.cos(maxTiltRad + slopeRad) / Math.cos(slopeRad);
}

/** The safe area of the viewport: what panels leave free. */
export function safeSize(viewport: Viewport): { width: number; height: number } {
  const i = viewport.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return { width: Math.max(1, viewport.width - i.left - i.right), height: Math.max(1, viewport.height - i.top - i.bottom) };
}

/** Zoom (px per world unit) at which the whole grove (canopy and ground) fits the safe viewport at a given tilt. */
export function fitZoom(viewport: Viewport, tilt: number, p: Pick<Params, "bedRadius" | "trunk">): number {
  const { width, height } = safeSize(viewport);
  const w = 2 * p.bedRadius * 1.03;
  const h = (2 * p.bedRadius * Math.cos(tilt) + (p.trunk + 4) * Math.sin(tilt)) * 1.03;
  return Math.min(width / w, height / h);
}

/** Radius (px) of the disc a w x h label needs to fit whichever way the bed is turned, seen from `tilt`. */
export function labelDiscPx(w: number, h: number, tilt: number): number {
  return Math.hypot(w / 2, h / (2 * Math.cos(tilt)));
}

/** World radius of the disc a w x h px label needs at every permitted view, at `zoomFactor` x the overview zoom. */
export function labelDisc(w: number, h: number, viewport: Viewport, zoomFactor: number, p: Pick<Params, "bedRadius" | "trunk" | "maxTilt">): number {
  let worst = 0;
  for (let i = 0; i <= 13; i++) {
    const tilt = (p.maxTilt * i) / 13;
    worst = Math.max(worst, labelDiscPx(w, h, tilt) / (fitZoom(viewport, tilt, p) * zoomFactor));
  }
  return worst;
}

export interface Basis {
  /** Unit vector toward the camera. */
  d: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

/** Screen basis of an orthographic camera at azimuth `az`, `tilt` off the vertical. World: x, height y, z. */
export function viewBasis(az: number, tilt: number): Basis {
  const d: [number, number, number] = [Math.sin(tilt) * Math.sin(az), Math.cos(tilt), Math.sin(tilt) * Math.cos(az)];
  const right: [number, number, number] = [Math.cos(az), 0, -Math.sin(az)];
  const up: [number, number, number] = [d[1] * right[2] - d[2] * right[1], d[2] * right[0] - d[0] * right[2], d[0] * right[1] - d[1] * right[0]];
  return { d, right, up };
}

/** World (x, height, z) to screen units before zoom. Screen y points up. */
export function project(b: Basis, x: number, y: number, z: number): Vec2 {
  return [x * b.right[0] + y * b.right[1] + z * b.right[2], x * b.up[0] + y * b.up[1] + z * b.up[2]];
}

/** Where the view ray through the world point (x, height, z) meets the canopy plane, as a plan point. */
export function dropToPlane(b: Basis, x: number, y: number, z: number): Vec2 {
  const t = y / b.d[1];
  return [x - b.d[0] * t, z - b.d[2] * t];
}
