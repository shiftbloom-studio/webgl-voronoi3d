// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The promise of the package: whatever the data and the permitted view, nothing hides anything else.

import { describe, expect, it } from "vitest";
import { DEG, checkFrame, checkGuarantees, guaranteeHolds, interpolateLayout, layoutCanopy, resolveParams, type Viewport } from "../src/index.js";
import { grove, measure } from "./fixtures/grove.js";

const VIEWPORTS: Viewport[] = [
  { width: 1112, height: 792 },
  { width: 1600, height: 1000 },
  { width: 760, height: 900 },
];
const SEEDS = [7, 21, 99];

const kinds = (v: { kind: string }[]) => v.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});

describe("canopy guarantees", () => {
  for (const viewport of VIEWPORTS) {
    for (const seed of SEEDS) {
      it(`${viewport.width}x${viewport.height}, seed ${seed}: no violation at any permitted view`, () => {
        const data = grove(seed);
        const layout = layoutCanopy(data, viewport, measure);
        expect(kinds(checkGuarantees(layout, undefined, data.nodes.length))).toEqual({});
        expect(layout.regions.length).toBeGreaterThan(1);
      });
    }
  }

  it("holds with 1.8x the nodes", () => {
    const data = grove(5, 1.8);
    const layout = layoutCanopy(data, VIEWPORTS[0]!, measure);
    expect(kinds(checkGuarantees(layout, undefined, data.nodes.length))).toEqual({});
  });

  it("groups small regions on a phone instead of shrinking titles (3.8)", () => {
    const data = grove(7);
    const layout = layoutCanopy(data, { width: 390, height: 760 }, measure, { more: (n) => `${n} more` });
    expect(kinds(checkGuarantees(layout, undefined, data.nodes.length))).toEqual({});
    const group = layout.regions.find((r) => r.members);
    expect(group).toBeDefined();
    expect(group!.label).toBe(`${group!.members!.length} more`);
    // Every top-level region is either shown or named inside the group.
    const tops = data.regions.filter((r) => !r.parent).map((r) => r.id);
    const shown = new Set([...layout.regions.map((r) => r.id), ...layout.regions.flatMap((r) => r.members ?? [])]);
    for (const id of tops) expect(shown.has(id)).toBe(true);
  });

  it("respects the safe area left by panels", () => {
    const data = grove(21);
    const layout = layoutCanopy(data, { width: 1600, height: 1000, inset: { top: 0, right: 420, bottom: 0, left: 0 } }, measure);
    expect(kinds(checkGuarantees(layout, undefined, data.nodes.length))).toEqual({});
  });
});

describe("lens", () => {
  const viewport = VIEWPORTS[0]!;
  const data = grove(7);
  const overview = layoutCanopy(data, viewport, measure);

  for (const focus of ["library", "garden", "inbox"]) {
    it(`focus on ${focus}: guarantees hold, every topic name shows without zooming`, () => {
      const lens = layoutCanopy(data, viewport, measure, { focus, previous: overview });
      expect(kinds(checkGuarantees(lens, undefined, data.nodes.length))).toEqual({});
      const named = lens.tufts.filter((t) => t.region === focus && t.label);
      for (const t of named) expect(t.labelZoom).toBeLessThanOrEqual(1 + 1e-9);
      const before = overview.regions.find((r) => r.id === focus)!;
      const after = lens.regions.find((r) => r.id === focus)!;
      expect(after.r).toBeGreaterThan(before.r);
    });
  }

  it("keeps regions in place on a warm start", () => {
    const again = layoutCanopy(data, viewport, measure, { previous: overview });
    for (const r of overview.regions) {
      const a = overview.sites[r.id]!;
      const b = again.sites[r.id]!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(8);
    }
  });

  it("every frame of the morph keeps cells, crowns and titles apart", () => {
    const lens = layoutCanopy(data, viewport, measure, { focus: "garden", previous: overview });
    for (let i = 1; i < 21; i++) {
      const frame = interpolateLayout(overview, lens, i / 21);
      expect(frame.regions).toHaveLength(overview.regions.length);
      expect(kinds(checkFrame(frame, lens))).toEqual({});
    }
  });

  it("morph frames are cheap enough to compute every animation frame", () => {
    const lens = layoutCanopy(data, viewport, measure, { focus: "library", previous: overview });
    for (let i = 0; i < 40; i++) interpolateLayout(overview, lens, i / 40);
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) interpolateLayout(overview, lens, i / 40);
    // Budget is 2 ms in the browser; CI machines vary, so this only catches regressions by an order of magnitude.
    expect((performance.now() - t0) / 40).toBeLessThan(20);
  });
});

describe("parameters", () => {
  it("refuses a slope and tilt that could let one crown cover another", () => {
    expect(guaranteeHolds(24 * DEG, 52 * DEG)).toBe(true);
    expect(guaranteeHolds(40 * DEG, 50 * DEG)).toBe(false);
    expect(() => resolveParams({ slope: 40 * DEG, maxTilt: 50 * DEG })).toThrow(RangeError);
    expect(() => layoutCanopy(grove(7), VIEWPORTS[0]!, measure, { params: { slope: 38 * DEG, maxTilt: 55 * DEG } })).toThrow(RangeError);
  });

  it("is deterministic: same input, same layout", () => {
    const a = layoutCanopy(grove(7), VIEWPORTS[0]!, measure, { focus: "studio" });
    const b = layoutCanopy(grove(7), VIEWPORTS[0]!, measure, { focus: "studio" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not depend on input order", () => {
    const data = grove(21);
    const a = layoutCanopy(data, VIEWPORTS[0]!, measure);
    const b = layoutCanopy({ regions: [...data.regions].reverse(), nodes: [...data.nodes].reverse() }, VIEWPORTS[0]!, measure);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
