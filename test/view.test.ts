// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { DEG, resolveParams } from "../src/index.js";
import { clampView, projection, toPlan, toScreen, viewOn, zoomAt } from "../src/three/view.js";

const p = resolveParams();
const screen = { width: 1280, height: 800, inset: { top: 0, right: 300, bottom: 0, left: 0 } };

describe("turntable", () => {
  it("never tilts past maxTilt and never zooms out past the whole grove", () => {
    const v = clampView({ azimuth: 0, tilt: 80 * DEG, zoom: 0.2, center: [50, 50] }, p);
    expect(v.tilt).toBe(p.maxTilt);
    expect(v.zoom).toBe(1);
    expect(v.center).toEqual([0, 0]);
  });

  it("maps a screen point to the canopy plane and back", () => {
    const pr = projection({ azimuth: 0.7, tilt: 40 * DEG, zoom: 2.3, center: [5, -3] }, screen, p);
    for (const [x, z] of [
      [0, 0],
      [40, -12],
      [-73, 55],
    ] as const) {
      const s = toScreen(pr, x, 0, z);
      const q = toPlan(pr, s[0], s[1]);
      expect(q[0]).toBeCloseTo(x, 9);
      expect(q[1]).toBeCloseTo(z, 9);
    }
  });

  it("keeps the point under the pointer in place while zooming", () => {
    const v = { azimuth: -0.4, tilt: 30 * DEG, zoom: 1.5, center: [0, 0] as [number, number] };
    const before = toPlan(projection(v, screen, p), 700, 300);
    const next = zoomAt(v, screen, p, 1.6, 700, 300);
    const after = toPlan(projection(next, screen, p), 700, 300);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("centres a world point in the safe rectangle", () => {
    const v = viewOn({ azimuth: 1, tilt: 35 * DEG, zoom: 1, center: [0, 0] }, screen, p, 20, 3, -10, 4);
    const s = toScreen(projection(v, screen, p), 20, 3, -10);
    expect(s[0]).toBeCloseTo((1280 - 300) / 2, 6);
    expect(s[1]).toBeCloseTo(400, 6);
  });
});
