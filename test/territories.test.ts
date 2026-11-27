// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { findTerritories, seeded, type TerritoryEdge, type TerritoryNode } from "../src/index.js";

/** Planted topics: dense links inside, sparse links between, one naming node per topic and a hub everyone links to. */
function planted(topics: number, size: number, seed = 3) {
  const rnd = seeded(seed);
  const nodes: TerritoryNode[] = [{ id: "hub", label: "Hub", kind: "tag" }];
  const edges: TerritoryEdge[] = [];
  for (let t = 0; t < topics; t++) {
    nodes.push({ id: `tag${t}`, label: `Topic ${t}`, kind: "tag" });
    for (let i = 0; i < size; i++) {
      const id = `n${t}_${i}`;
      nodes.push({ id, label: id, group: t % 2 ? "odd" : "even" });
      edges.push({ source: id, target: `tag${t}` }, { source: id, target: "hub" });
      for (let k = 0; k < 4; k++) edges.push({ source: id, target: `n${t}_${Math.floor(rnd() * size)}`, weight: 0.8 });
      if (rnd() < 0.1) edges.push({ source: id, target: `n${(t + 1) % topics}_${Math.floor(rnd() * size)}`, weight: 0.5 });
    }
  }
  return { nodes, edges };
}

const namesFrom = (n: TerritoryNode) => n.kind === "tag";

describe("findTerritories", () => {
  it("finds planted topics and names them after their own tag, not the hub", () => {
    const { nodes, edges } = planted(6, 30);
    const { territories, territoryOf } = findTerritories(nodes, edges, { namesFrom });
    expect(territories.length).toBeGreaterThanOrEqual(5);
    expect(territories.length).toBeLessThanOrEqual(8);
    for (let t = 0; t < 6; t++) {
      const home = territoryOf.get(`n${t}_0`)!;
      const same = Array.from({ length: 30 }, (_, i) => territoryOf.get(`n${t}_${i}`) === home).filter(Boolean).length;
      expect(same).toBeGreaterThanOrEqual(27);
      expect(territories[home]!.name.startsWith("Hub")).toBe(false);
    }
  });

  it("is deterministic", () => {
    const { nodes, edges } = planted(5, 25);
    const a = findTerritories(nodes, edges, { namesFrom });
    const b = findTerritories([...nodes].reverse(), edges, { namesFrom });
    expect(b.territories.map((t) => [t.name, t.members])).toEqual(a.territories.map((t) => [t.name, t.members]));
  });

  it("assigns every node exactly once and respects the bounds", () => {
    const { nodes, edges } = planted(30, 8);
    nodes.push({ id: "alone1", group: "x" }, { id: "alone2", group: "x" });
    const { territories, territoryOf } = findTerritories(nodes, edges, { namesFrom, maxTerritories: 12 });
    expect(territories.length).toBeLessThanOrEqual(12);
    expect(territoryOf.size).toBe(nodes.length);
    expect(territories.reduce((s, t) => s + t.members.length, 0)).toBe(nodes.length);
    expect(territories.every((t) => t.members.length >= 4)).toBe(true);
  });

  it("splits a giant region into readable parts", () => {
    const { nodes, edges } = planted(4, 150);
    // Glue everything into one blob with strong cross links.
    for (let t = 0; t < 4; t++) for (let i = 0; i < 150; i += 3) edges.push({ source: `n${t}_${i}`, target: `n${(t + 1) % 4}_${i}`, weight: 1 });
    const { territories } = findTerritories(nodes, edges, { namesFrom });
    expect(Math.max(...territories.map((t) => t.members.length))).toBeLessThanOrEqual(260);
  });

  it("handles empty and edgeless graphs", () => {
    expect(findTerritories([], []).territories).toEqual([]);
    const { territories } = findTerritories([{ id: "a", group: "g" }, { id: "b", group: "g" }, { id: "c" }], []);
    expect(territories.map((t) => t.name).sort()).toEqual(["g", "ungrouped"]);
  });
});
