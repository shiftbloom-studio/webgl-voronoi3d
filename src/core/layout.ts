// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regions and nodes in, canopy out: cells, hearts, tufts, crowns, leaf positions and label sizes.
// Deterministic: the same input gives the same layout; ties are broken by id.

import { DEG, fitZoom, guaranteeHolds, labelDisc } from "./camera.js";
import { crown, crownHeight, fitPitch } from "./crown.js";
import { type Polygon, type Treemap, type Vec2, incircle, insetPoly, polyArea, reach, regularPolygon, solveTreemap, spiralSites } from "./geometry.js";
import type { CanopyLayout, LayoutOptions, LeafLayout, Measure, NodeInput, Params, RegionInput, RegionLayout, TuftLayout, Viewport } from "./types.js";

export const DEFAULT_PARAMS: Params = {
  bedRadius: 100,
  maxTilt: 52 * DEG,
  slope: 24 * DEG,
  gapRegion: 3.2,
  gapTuft: 1,
  trunk: 34,
  skirt: 2.6,
  focusZoom: 3.6,
  focusShare: 0.46,
  minRing: 0.25,
  maxRing: 0.86,
  leafAspect: 1.45,
  leafFill: 0.9,
};

/** Full parameters; throws when slope + maxTilt would let one crown cover another. */
export function resolveParams(p?: Partial<Params>): Params {
  const r = { ...DEFAULT_PARAMS, ...p };
  if (!guaranteeHolds(r.slope, r.maxTilt)) {
    throw new RangeError(`webgl-voronoi3d: slope (${(r.slope / DEG).toFixed(1)}°) + maxTilt (${(r.maxTilt / DEG).toFixed(1)}°) must stay below 90°, or cells could hide each other.`);
  }
  return r;
}

const FOCUS_SHARE_MAX = 0.72;

const byId = (a: { id: string }, b: { id: string }) => Number(a.id > b.id) - Number(a.id < b.id);

interface Top {
  input: RegionInput;
  children: RegionInput[];
  members: string[] | null;
}

/** Regions resolved to two levels, and every node mapped to the region it is drawn in. */
function prepare(regions: RegionInput[], nodes: NodeInput[]) {
  const ids = new Map(regions.map((r) => [r.id, r]));
  // Deeper levels fold into their level-2 ancestor; unknown parents make a region top-level.
  const levelOf = (r: RegionInput): RegionInput[] => {
    const chain = [r];
    let cur = r;
    const seen = new Set([r.id]);
    while (cur.parent && ids.has(cur.parent) && !seen.has(cur.parent)) {
      cur = ids.get(cur.parent)!;
      seen.add(cur.id);
      chain.unshift(cur);
    }
    return chain;
  };
  const top: Top[] = [];
  const topIndex = new Map<string, Top>();
  const drawnIn = new Map<string, string>();
  for (const r of [...regions].sort(byId)) {
    const chain = levelOf(r);
    if (chain.length === 1) {
      const t: Top = { input: r, children: [], members: null };
      top.push(t);
      topIndex.set(r.id, t);
    }
  }
  for (const r of [...regions].sort(byId)) {
    const chain = levelOf(r);
    if (chain.length === 2) topIndex.get(chain[0]!.id)!.children.push(r);
    drawnIn.set(r.id, (chain[1] ?? chain[0]!).id);
  }
  const nodesOf = new Map<string, NodeInput[]>();
  const nodeRegion: Record<string, string> = {};
  for (const n of [...nodes].sort(byId)) {
    const region = drawnIn.get(n.region);
    if (!region) continue;
    nodeRegion[n.id] = region;
    const list = nodesOf.get(region);
    if (list) list.push(n);
    else nodesOf.set(region, [n]);
  }
  return { top, nodesOf, nodeRegion };
}

/** Folds the smallest top-level regions into one group region whose children are the folded regions. */
function group(top: Top[], nodesOf: Map<string, NodeInput[]>, nodeRegion: Record<string, string>, count: (t: Top) => number, more: (n: number) => string, keep: string | null): Top[] {
  const existing = top.find((t) => t.members);
  // The region in the lens stays itself as long as anything else can be folded.
  const loose = top.filter((t) => !t.members && (t.input.id !== keep || top.length <= 2));
  // Pinned regions are folded last, only when nothing else is left.
  const candidates = (loose.some((t) => !t.input.pin) ? loose.filter((t) => !t.input.pin) : loose).sort((a, b) => count(a) - count(b) || byId(a.input, b.input));
  const take = candidates.slice(0, existing ? 1 : 2);
  if (!take.length) return top;
  const g: Top = existing ?? { input: { id: "group:more", label: "", parent: null }, children: [], members: [] };
  for (const t of take) {
    g.members!.push(t.input.id);
    g.children.push({ id: t.input.id, parent: g.input.id, label: t.input.label });
    // Everything inside a folded region is drawn in its one tuft.
    const all = [...(nodesOf.get(t.input.id) ?? []), ...t.children.flatMap((c) => nodesOf.get(c.id) ?? [])];
    for (const c of t.children) nodesOf.delete(c.id);
    nodesOf.set(t.input.id, all);
    for (const n of all) nodeRegion[n.id] = t.input.id;
  }
  g.input = { ...g.input, label: more(g.members!.length) };
  return [...top.filter((t) => !take.includes(t) && t !== g), g];
}

export function layoutCanopy(input: { regions: RegionInput[]; nodes: NodeInput[] }, viewport: Viewport, measure: Measure, options: LayoutOptions = {}): CanopyLayout {
  const p = resolveParams(options.params);
  const more = options.more ?? ((n: number) => `${n} more`);
  const bed = regularPolygon(72, p.bedRadius);
  const bedArea = Math.abs(polyArea(bed));
  const { top: prepared, nodesOf, nodeRegion } = prepare(input.regions, input.nodes);
  const count = (t: Top) => t.children.reduce((s, c) => s + (nodesOf.get(c.id)?.length ?? 0), 0) + (nodesOf.get(t.input.id)?.length ?? 0);
  const share = (t: Top) => t.input.weight ?? count(t);

  const titleSize = (t: Top) => {
    const a = measure(t.input.label, "title");
    const b = t.input.caption ? measure(t.input.caption, "caption") : { width: 0, height: 0 };
    return { width: Math.max(a.width, b.width), height: a.height + b.height };
  };

  const previousSites = options.previous?.sites ?? {};
  const solveTop = (top: Top[], fit: number, focusShare: number) => {
    const sizes = top.map(titleSize);
    const discs = sizes.map((s) => labelDisc(s.width, s.height, viewport, 1, p) * 1.06);
    const floors = discs.map((d) => Math.PI * d * d * 3.4);
    if (top.length > 1 && floors.reduce((s, f) => s + f, 0) > bedArea * 0.8) return null;
    const total = top.reduce((s, t) => s + share(t), 0);
    const free = Math.max(0.15 * bedArea, bedArea - floors.reduce((s, f) => s + f, 0));
    const boost = top.map((t) => options.areaBoost?.get(t.input.id) ?? 1);
    const boostedTotal = top.reduce((s, t, i) => s + share(t) * boost[i]!, 0);
    let targets = top.map((t, i) => floors[i]! + (free * share(t) * boost[i]!) / Math.max(boostedTotal || total, 1));
    // The lens: a focused region takes a large share of the bed, the others keep at least their floor.
    const fi = top.findIndex((t) => t.input.id === options.focus);
    if (fi >= 0) {
      const want = Math.max(targets[fi]!, focusShare * bedArea);
      const others = top.reduce((s, t, i) => s + (i === fi ? 0 : share(t) * boost[i]!), 0);
      const left = Math.max(0, bedArea - want - floors.reduce((s, f, i) => s + (i === fi ? 0 : f), 0));
      targets = top.map((t, i) => (i === fi ? want : floors[i]! + (left * share(t) * boost[i]!) / Math.max(others, 1)));
    }

    // Start sites: previous places first, new regions on the free spiral slot farthest from them.
    const order = top.map((_, i) => i).sort((a, b) => Number(Boolean(top[b]!.input.pin)) - Number(Boolean(top[a]!.input.pin)) || targets[b]! - targets[a]! || byId(top[a]!.input, top[b]!.input));
    const spiral = spiralSites(bed, Math.max(top.length * 2, 1), 0.6);
    const sites: Vec2[] = new Array(top.length);
    const taken: Vec2[] = [];
    for (const i of order) {
      const prev = previousSites[top[i]!.input.id];
      if (top[i]!.input.pin) sites[i] = [0, 0];
      else if (prev && Math.hypot(prev[0], prev[1]) < p.bedRadius * 0.98) sites[i] = [prev[0], prev[1]];
      else continue;
      taken.push(sites[i]!);
    }
    const hasPrevious = taken.length > 0;
    let spiralNext = 0;
    for (const i of order) {
      if (sites[i]) continue;
      if (!hasPrevious) {
        sites[i] = spiral[spiralNext++]!;
      } else {
        let best = spiral[0]!;
        let bestD = -1;
        for (const s of spiral) {
          const d = Math.min(...taken.map((t) => Math.hypot(t[0] - s[0], t[1] - s[1])));
          if (d > bestD) [best, bestD] = [s, d];
        }
        sites[i] = best;
      }
      taken.push(sites[i]!);
    }

    let solved: Treemap | null = null;
    for (let round = 0; round < 6; round++) {
      solved = solveTreemap(
        bed,
        top.map((t, i) => ({ target: targets[i]!, site: solved ? solved.sites[i]! : sites[i]!, pin: Boolean(t.input.pin) })),
      );
      // A region must hold its title disc with room to spare; if not, it gets more area.
      let tight = false;
      solved.cells.forEach((cell, i) => {
        const inner = insetPoly(cell, p.gapRegion / 2);
        if (!inner.length || incircle(inner).r < discs[i]! * fit) {
          targets[i]! *= 1.18;
          tight = true;
        }
      });
      if (!tight) return { solved, sizes, discs };
    }
    return top.length <= 1 ? { solved: solved!, sizes, discs } : null;
  };

  // Fewest groups first: a roomy fit, then a tighter one, then fold the smallest regions together (3.8).
  // A set of regions is accepted only when every heart holds its title.
  let top = prepared;
  let built: ReturnType<typeof buildRegions> = null;
  for (;;) {
    // In the lens a smaller lens is better than more folding: the focus shrinks before anything is grouped.
    // Last resort: the region keeps its overview size and its topic names wait for the zoom, as everywhere else.
    const shares = top.some((t) => t.input.id === options.focus) ? [1, 0.75, 0.5, -1].map((f) => f * p.focusShare) : [-1];
    const attempt = (share: number) => {
      for (const fit of [1.9, 1.45]) {
        const result = solveTop(top, fit, Math.max(0, share));
        const b = result && buildRegions(top, result, false, share >= 0);
        if (b) return b;
      }
      return null;
    };
    for (const share of shares) {
      built = attempt(share);
      if (!built) continue;
      // The lens promises every topic name at once. Names still short: a larger share, up to 72 % of the bed.
      // Radii grow with the root of the share, so a region further off than that keeps its label zooms.
      let s = share;
      for (;;) {
        const worst = Math.max(1, ...built.tufts.filter((tf) => tf.region === options.focus && tf.label).map((tf) => tf.labelZoom));
        if (s <= 0 || worst <= 1 + 1e-9 || s >= FOCUS_SHARE_MAX || worst * worst * s > FOCUS_SHARE_MAX) break;
        s = Math.min(FOCUS_SHARE_MAX, s * Math.max(1.1, worst * worst * 1.08));
        const wider = attempt(s);
        if (!wider) break;
        built = wider;
      }
      break;
    }
    if (built || top.length <= 1) break;
    top = group(top, nodesOf, nodeRegion, count, more, options.focus ?? null);
  }
  if (!built) {
    // One region that cannot hold its title at the overview zoom: the viewport is smaller than one title.
    const sizes = top.map(titleSize);
    built = buildRegions(top, { solved: solveTreemap(bed, [{ target: 1, site: [0, 0], pin: true }]), sizes, discs: sizes.map(() => 0) }, true)!;
  }
  function buildRegions(top: Top[], { solved, sizes, discs }: { solved: Treemap; sizes: { width: number; height: number }[]; discs: number[] }, force = false, lens = true) {
    const regions: RegionLayout[] = [];
    const tufts: TuftLayout[] = [];
    // Building deals nodes into tufts; a rejected build must leave the shared map as it was.
    const local = new Map(nodesOf);
    let failed = false;
    top.forEach((t, i) => {
      if (failed && !force) return;
      const r = t.input;
      const cell = solved.cells[i]!;
      const poly = insetPoly(cell, p.gapRegion / 2);
      const focused = lens && r.id === options.focus;
      const promised = focused ? 1 : p.focusZoom;
      const circle = incircle(poly);
      let children = t.children.map((c) => ({ id: c.id, label: c.label }));
      if (children.length < 3) {
        // Too few topics to surround a heart: the nodes are dealt into three unnamed tufts by rank, so every region has the same build.
        const all = [...(local.get(r.id) ?? []), ...children.flatMap((c) => local.get(c.id) ?? [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || byId(a, b));
        children = [0, 1, 2].map((k) => ({ id: `${r.id}/~${k}`, label: "" }));
        children.forEach((c, k) =>
          local.set(
            c.id,
            all.filter((_, j) => j % 3 === k),
          ),
        );
      } else if (local.get(r.id)?.length) {
        // Nodes on a region that has topics go to its smallest topic.
        const own = local.get(r.id)!;
        const smallest = [...children].sort((a, b) => (local.get(a.id)?.length ?? 0) - (local.get(b.id)?.length ?? 0) || byId(a, b))[0]!;
        local.set(smallest.id, [...(local.get(smallest.id) ?? []), ...own]);
      }
      const heartNeed = discs[i]!;
      let heartTarget = Math.PI * heartNeed ** 2 * 1.3;
      const childCounts = children.map((c) => (local.get(c.id)?.length ?? 0) + 2);
      const labelSizes = children.map((c) => (c.label ? measure(c.label, "topic") : null));
      const tableNeed = labelSizes.map((m) => (m ? labelDisc(m.width, m.height, viewport, promised, p) * 1.05 : 0));
      const boost = children.map(() => 1);
      const ringStart = children.map((_, k): Vec2 => {
        const a = 0.4 + (k / children.length) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const rr = reach(poly, circle.c, dx, dy) * 0.62;
        return [circle.c[0] + dx * rr, circle.c[1] + dy * rr];
      });
      const area = Math.abs(polyArea(poly));
      let sub: Treemap | null = null;
      for (let round = 0; round < 24; round++) {
        // Every tuft gets room for its own table, the rest is shared by the number of leaves.
        const tables = tableNeed.map((tn, k) => Math.PI * tn * tn * 1.5 * boost[k]!);
        const rest = Math.max(0.3 * area, area - heartTarget - tables.reduce((s, x) => s + x, 0));
        const sumC = childCounts.reduce((s, c) => s + c, 0);
        sub = solveTreemap(poly, [
          { target: heartTarget, site: circle.c, pin: true },
          ...children.map((c, k) => ({ target: tables[k]! + (rest * childCounts[k]!) / sumC, site: sub ? sub.sites[k + 1]! : ringStart[k]! })),
        ]);
        const heartPoly = insetPoly(sub.cells[0]!, p.gapTuft / 2);
        let tight = !(heartPoly.length > 0 && incircle(heartPoly).r >= heartNeed);
        if (tight) heartTarget *= 1.1;
        if (focused) {
          // In the lens every topic name is promised right away, so every table has to hold its disc.
          children.forEach((c, k) => {
            if (!c.label) return;
            const tp = insetPoly(sub!.cells[k + 1]!, p.gapTuft / 2);
            const have = tp.length >= 3 ? incircle(tp).r * 0.75 : 0;
            if (have < tableNeed[k]!) {
              boost[k]! *= have > 0 ? Math.min(1.6, Math.max(1.08, (tableNeed[k]! / have) ** 2 * 1.06)) : 1.6;
              tight = true;
            }
          });
        }
        if (!tight) break;
      }
      const made = children.map((c, k) => makeTuft(c.id, r.id, c.label, labelSizes[k]!, insetPoly(sub!.cells[k + 1]!, p.gapTuft / 2), tableNeed[k]!, promised, local.get(c.id) ?? [], p));
      const heartPoly = insetPoly(sub!.cells[0]!, p.gapTuft / 2);
      const hi = incircle(heartPoly);
      const kept = made.filter((tf) => tf.poly.length >= 3);
      // Every title in its heart, every node on a slot, or this set of regions is rejected.
      if (hi.r < heartNeed * (1 - 1e-9) || made.some((tf) => tf.slots.length < tf.nodes.length)) failed = true;
      tufts.push(...kept);
      regions.push({
        id: r.id,
        label: r.label,
        caption: r.caption,
        cell,
        poly,
        c: circle.c,
        r: circle.r,
        tone: 0,
        count: count(t),
        titleSize: sizes[i]!,
        titleDisc: heartNeed,
        heart: { c: hi.c, r: hi.r, poly: heartPoly },
        tufts: kept.map((tf) => tf.id),
        members: t.members ? [...t.members] : null,
        sub: { ids: [null, ...children.map((c) => c.id)], sites: sub!.sites, weights: sub!.weights, tableRadius: [0, ...tableNeed] },
      });
    });
    return failed && !force ? null : { regions, tufts, solved };
  }

  const { regions, tufts, solved } = built;
  placeLeaves(tufts, p);
  toneRegions(regions);
  const sites: Record<string, Vec2> = {};
  const weights: Record<string, number> = {};
  top.forEach((t, i) => {
    sites[t.input.id] = solved.sites[i]!;
    weights[t.input.id] = solved.weights[i]!;
  });
  return { params: p, viewport, bed, regions, tufts, sites, weights, nodeRegion, focus: options.focus ?? null, areaError: solved.err };
}

interface PendingTuft extends TuftLayout {
  nodes: NodeInput[];
  pitch: number;
  slots: ReturnType<typeof fitPitch>["slots"];
}

function makeTuft(
  id: string,
  region: string,
  label: string,
  labelSize: { width: number; height: number } | null,
  poly: Polygon,
  tableRadius: number,
  promised: number,
  nodes: NodeInput[],
  p: Params,
): PendingTuft {
  const sorted = [...nodes].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || byId(a, b));
  if (poly.length < 3) {
    return {
      id,
      region,
      label,
      poly,
      crown: crown(
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        p.slope,
        0,
      ),
      labelZoom: Infinity,
      labelSize,
      tableRadius,
      leaves: [],
      nodes: sorted,
      pitch: 0,
      slots: [],
    };
  }
  const cr = crown(poly, p.slope, tableRadius, p);
  const { pitch, slots } = fitPitch(cr, sorted.length, { aspect: p.leafAspect, fill: p.leafFill });
  // The zoom (x overview) from which this topic's name fits on its table.
  const labelZoom = label ? (tableRadius * promised) / cr.tableRadius : Infinity;
  return { id, region, label, poly, crown: cr, labelZoom, labelSize, tableRadius, leaves: [], nodes: sorted, pitch, slots };
}

/** Leaves have one size across the canopy (the median pitch); a crown tighter than that gets smaller ones. */
function placeLeaves(tufts: TuftLayout[], p: Params) {
  const pending = tufts as PendingTuft[];
  const pitches = pending
    .filter((t) => t.nodes.length)
    .map((t) => t.pitch)
    .sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)] ?? 1;
  for (const t of pending) {
    const own = Math.min(t.pitch, median * 1.7);
    t.leaves = t.nodes
      .map((n, k): LeafLayout | null => {
        const s = t.slots[k];
        return s ? { node: n.id, tuft: t.id, p: s.p, y: crownHeight(t.crown, s.p), facet: s.facet, a: own * p.leafAspect * p.leafFill, b: own * p.leafFill } : null;
      })
      .filter((l): l is LeafLayout => l !== null);
    delete (t as Partial<PendingTuft>).nodes;
    delete (t as Partial<PendingTuft>).pitch;
    delete (t as Partial<PendingTuft>).slots;
  }
}

/** Two top-level cells are neighbours when they share a stretch of boundary. */
export function regionNeighbours(regions: RegionLayout[]): Map<string, string[]> {
  const out = new Map<string, string[]>(regions.map((r) => [r.id, []]));
  const onEdge = (P: Polygon, q: Vec2) => {
    for (let i = 0; i < P.length; i++) {
      const a = P[i]!;
      const b = P[(i + 1) % P.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const cross = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / len;
      const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (len * len);
      if (cross < 1e-6 && t > -1e-6 && t < 1 + 1e-6) return true;
    }
    return false;
  };
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const A = regions[i]!;
      const B = regions[j]!;
      const shared = A.cell.filter((q) => onEdge(B.cell, q)).length + B.cell.filter((q) => onEdge(A.cell, q)).length;
      if (shared >= 2) {
        out.get(A.id)!.push(B.id);
        out.get(B.id)!.push(A.id);
      }
    }
  }
  return out;
}

/** Neighbouring regions never share a tone: greedy colouring over the corridor graph, biggest first. */
function toneRegions(regions: RegionLayout[]) {
  const neighbours = regionNeighbours(regions);
  const tone = new Map<string, number>();
  const order = [...regions].sort((a, b) => neighbours.get(b.id)!.length - neighbours.get(a.id)!.length || byId(a, b));
  for (const r of order) {
    const used = new Set(
      neighbours
        .get(r.id)!
        .map((n) => tone.get(n))
        .filter((t) => t !== undefined),
    );
    let t = 0;
    while (used.has(t)) t++;
    tone.set(r.id, t);
  }
  for (const r of regions) r.tone = tone.get(r.id)! % 4;
}

/** Zoom (px per world unit) of the overview at a tilt, for this layout. */
export function overviewZoom(layout: CanopyLayout, tilt: number): number {
  return fitZoom(layout.viewport, tilt, layout.params);
}
