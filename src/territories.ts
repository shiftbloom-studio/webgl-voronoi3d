// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Splits a graph into territories: groups of nodes that belong together.
// Louvain community detection on the links, then a clean-up pass so the result
// reads well as a map: no giant regions, no crumbs, a bounded count, and a short
// name for each territory taken from the naming nodes its members link to most
// (and other territories link to least).

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { TerritoryEdge, TerritoryNode } from "./types.js";
import { seeded } from "./random.js";

export interface Territory {
  /** 0 is the largest territory; ids are stable for the same input. */
  id: number;
  name: string;
  /** The group most of its members belong to, if nodes carry groups. */
  group: string | null;
  members: string[];
}

export interface Territories {
  territories: Territory[];
  territoryOf: Map<string, number>;
  /** Summed tie strength between two territories, keyed "a|b" with a < b. */
  between: Map<string, number>;
}

export interface TerritoryOptions {
  /**
   * How strongly an edge ties its two nodes into one territory, 0 to 1.
   * `degree` is the larger link count of the edge's two ends, useful to weaken hubs.
   * Default: the edge's weight (or 1), divided down for hubs.
   */
  tie?: (edge: TerritoryEdge, degree: number) => number;
  /** Nodes whose labels may name a territory, e.g. entities or tags. Default: none, names fall back to groups. */
  namesFrom?: (node: TerritoryNode) => boolean;
  /** Upper bound on territories. Default 36. */
  maxTerritories?: number;
  /** Territories smaller than this fold into a neighbour. Default 4. */
  minSize?: number;
  /** Seed for the community detection, so the same graph always gives the same map. Default 1. */
  seed?: number;
}

const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

const defaultTie = (edge: TerritoryEdge, degree: number): number => Math.min(edge.weight ?? 1, 1) * Math.min(1, 12 / Math.max(degree, 1));

function weightedGraph(nodes: TerritoryNode[], edges: TerritoryEdge[], tie: NonNullable<TerritoryOptions["tie"]>): Graph {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const degree = new Map<string, number>();
  for (const e of valid) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const g = new Graph({ type: "undirected" });
  for (const n of nodes) if (!g.hasNode(n.id)) g.addNode(n.id);
  for (const e of valid) {
    const w = Math.max(0, tie(e, Math.max(degree.get(e.source) ?? 1, degree.get(e.target) ?? 1)));
    if (w === 0) continue;
    // Edges stored once per direction count once: the stronger tie per pair wins.
    const key = g.edge(e.source, e.target);
    if (key) g.setEdgeAttribute(key, "weight", Math.max(g.getEdgeAttribute(key, "weight") as number, w));
    else g.addEdge(e.source, e.target, { weight: w });
  }
  return g;
}

function communities(g: Graph, nodes: string[], resolution: number, seed: number): Map<string, number> {
  const sub = new Graph({ type: "undirected" });
  for (const n of nodes) sub.addNode(n);
  const inside = new Set(nodes);
  for (const n of nodes) {
    g.forEachEdge(n, (_key, attr, s, t) => {
      if (s === n && inside.has(t) && !sub.hasEdge(s, t)) sub.addEdge(s, t, { weight: attr.weight });
    });
  }
  if (sub.size === 0) return new Map(nodes.map((n) => [n, 0]));
  return new Map(Object.entries(louvain(sub, { getEdgeWeight: "weight", resolution, rng: seeded(seed) })));
}

function groupBy<T>(entries: Iterable<[string, T]>): Map<T, string[]> {
  const out = new Map<T, string[]>();
  for (const [id, key] of entries) {
    const list = out.get(key);
    if (list) list.push(id);
    else out.set(key, [id]);
  }
  return out;
}

export function findTerritories(nodes: TerritoryNode[], edges: TerritoryEdge[], options: TerritoryOptions = {}): Territories {
  const maxTerritories = Math.max(1, options.maxTerritories ?? 36);
  const minSize = Math.max(1, options.minSize ?? 4);
  const seed = options.seed ?? 1;
  if (nodes.length === 0) return { territories: [], territoryOf: new Map(), between: new Map() };
  const g = weightedGraph(nodes, edges, options.tie ?? defaultTie);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groupOf = (id: string) => byId.get(id)?.group ?? "";

  // 1. Louvain over everything that has links; unlinked nodes gather per group.
  const linked = g.filterNodes((n) => g.degree(n) > 0);
  const loose = groupBy(g.filterNodes((n) => g.degree(n) === 0).map((n) => [n, groupOf(n)] as [string, string]));
  let groups = [...groupBy(communities(g, linked, 1, seed)).values()];

  // 2. Split regions too big to read as one place. Slivers stay with the biggest part instead of becoming crumbs.
  const maxSize = Math.max(90, Math.ceil(nodes.length / 8));
  for (let round = 0; round < 2; round++) {
    const next: string[][] = [];
    for (const members of groups) {
      if (members.length <= maxSize) {
        next.push(members);
        continue;
      }
      const parts = [...groupBy(communities(g, members, 1.3 + round * 0.4, seed + 6 + round)).values()].sort((a, b) => b.length - a.length);
      const keep = parts.filter((p, i) => i === 0 || p.length >= maxSize / 4);
      for (const p of parts) if (!keep.includes(p)) keep[0]!.push(...p);
      next.push(...keep);
    }
    groups = next;
  }

  // 3. Fold crumbs, then the smallest regions while there are too many, into the neighbour they are most tied to.
  const strongestNeighbour = (i: number): number => {
    const of = new Map<string, number>();
    groups.forEach((members, j) => members.forEach((n) => of.set(n, j)));
    const ties = new Map<number, number>();
    for (const n of groups[i]!) {
      g.forEachEdge(n, (_key, attr, s, t) => {
        const j = of.get(s === n ? t : s);
        if (j === undefined || j === i) return;
        ties.set(j, (ties.get(j) ?? 0) + (attr.weight as number));
      });
    }
    let best = -1;
    let bestW = 0;
    for (const [j, w] of ties) if (w > bestW || (w === bestW && j < best)) [best, bestW] = [j, w];
    return best;
  };
  for (;;) {
    const live = groups.map((members, i) => ({ i, n: members.length })).filter((x) => x.n > 0).sort((a, b) => a.n - b.n || a.i - b.i);
    const victim = live[0] && (live[0].n < minSize || live.length > maxTerritories) ? live[0] : undefined;
    if (!victim) break;
    const j = strongestNeighbour(victim.i);
    if (j < 0) {
      // Nothing to lean on: these become loose nodes of their group.
      for (const n of groups[victim.i]!) loose.set(groupOf(n), [...(loose.get(groupOf(n)) ?? []), n]);
    } else groups[j]!.push(...groups[victim.i]!);
    groups[victim.i] = [];
  }
  groups = groups.filter((members) => members.length > 0);
  for (const [, ids] of [...loose.entries()].sort(([a], [b]) => byCodeUnit(a, b))) {
    if (groups.length < maxTerritories) groups.push(ids);
    else groups.reduce((a, b) => (b.length < a.length ? b : a)).push(...ids);
  }
  for (const members of groups) members.sort(byCodeUnit);
  groups.sort((a, b) => b.length - a.length || byCodeUnit(a[0]!, b[0]!));

  const territoryOf = new Map<string, number>();
  groups.forEach((members, i) => members.forEach((n) => territoryOf.set(n, i)));

  // 4. Names: the naming nodes a territory links to most, weighed against how many territories link to them.
  const namesFrom = options.namesFrom ?? (() => false);
  const counts = groups.map(() => new Map<string, number>());
  for (const e of edges) {
    for (const [namer, other] of [[e.target, e.source], [e.source, e.target]] as const) {
      const node = byId.get(namer);
      const t = territoryOf.get(other);
      if (!node || t === undefined || !namesFrom(node) || namer === other) continue;
      counts[t]!.set(namer, (counts[t]!.get(namer) ?? 0) + 1);
    }
  }
  const spread = new Map<string, number>();
  for (const c of counts) for (const n of c.keys()) spread.set(n, (spread.get(n) ?? 0) + 1);
  const used = new Set<string>();
  const territories: Territory[] = groups.map((members, id) => {
    const ranked = [...counts[id]!.entries()]
      .map(([n, c]) => ({ n, score: c * Math.log(1 + groups.length / (spread.get(n) ?? 1)) }))
      .sort((a, b) => b.score - a.score || byCodeUnit(a.n, b.n))
      .map((x) => byId.get(x.n)!.label ?? x.n);
    const groupCounts = groupBy(members.filter((m) => byId.get(m)!.group).map((m) => [m, groupOf(m)] as [string, string]));
    const group = [...groupCounts.entries()].sort((a, b) => b[1].length - a[1].length || byCodeUnit(a[0], b[0]))[0]?.[0] ?? null;
    let name = ranked.length >= 2 ? `${ranked[0]} · ${ranked[1]}` : (ranked[0] ?? group ?? "ungrouped");
    for (let k = 2; used.has(name) && k < ranked.length; k++) name = `${ranked[0]} · ${ranked[k]}`;
    if (used.has(name)) name = `${name} ${id + 1}`;
    used.add(name);
    return { id, name, group, members };
  });

  const between = new Map<string, number>();
  g.forEachEdge((_key, attr, s, t) => {
    const a = territoryOf.get(s)!;
    const b = territoryOf.get(t)!;
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    between.set(key, (between.get(key) ?? 0) + (attr.weight as number));
  });
  return { territories, territoryOf, between };
}
