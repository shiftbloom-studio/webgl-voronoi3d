// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { DEG, contains, crown, crownHeight, fitPitch, frameOf, incircle, interpolateLayout, layoutCanopy, type Polygon } from "../src/index.js";
import { grove, measure } from "./fixtures/grove.js";

const sliver: Polygon = [
  [0, 0],
  [60, 0],
  [62, 8],
  [1, 9],
];
const hexagon: Polygon = Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * Math.PI * 2) * 20, Math.sin((i / 6) * Math.PI * 2) * 20]);

describe("hip-roof crowns", () => {
  for (const [name, P] of [
    ["hexagon", hexagon],
    ["sliver", sliver],
  ] as const) {
    it(`${name}: no point is steeper than the slope, and the table holds its disc`, () => {
      const cr = crown(P, 24 * DEG, 3);
      const tan = Math.tan(24 * DEG);
      const { c, r } = incircle(P);
      expect(cr.tableRadius).toBeCloseTo(Math.max(r - Math.min(0.86 * r, Math.max(0.25 * r, r - 3)), 0), 9);
      // Finite differences in many directions never exceed the slope.
      for (let k = 0; k < 400; k++) {
        const a = k * 2.399963;
        const q: [number, number] = [c[0] + Math.cos(a) * r * ((k % 17) / 17), c[1] + Math.sin(a) * r * ((k % 13) / 13)];
        const dir = (k * 0.7) % (Math.PI * 2);
        const h = 1e-4;
        const q2: [number, number] = [q[0] + Math.cos(dir) * h, q[1] + Math.sin(dir) * h];
        if (!contains(P, q) || !contains(P, q2)) continue;
        expect(Math.abs(crownHeight(cr, q2) - crownHeight(cr, q)) / h).toBeLessThanOrEqual(tan * (1 + 1e-6));
      }
      for (const f of cr.facets) expect(f.slope).toBeCloseTo(tan, 12);
    });
  }

  it("fits at least n leaves, all inside their own face", () => {
    const cr = crown(hexagon, 24 * DEG, 4);
    const { pitch, slots } = fitPitch(cr, 40);
    expect(slots.length).toBeGreaterThanOrEqual(40);
    for (const s of slots) expect(contains(cr.facets[s.facet]!.poly, s.p)).toBe(true);
  });
});

describe("morph", () => {
  it("starts at layout a and ends at layout b", () => {
    const viewport = { width: 1112, height: 792 };
    const a = layoutCanopy(grove(7), viewport, measure);
    const b = layoutCanopy(grove(7), viewport, measure, { focus: "music", previous: a });
    expect(interpolateLayout(a, b, 0)).toEqual(frameOf(a, 0));
    expect(interpolateLayout(a, b, 1)).toEqual(frameOf(b, 1));
  });
});
