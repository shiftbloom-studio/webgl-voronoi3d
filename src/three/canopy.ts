// SPDX-License-Identifier: AGPL-3.0-or-later
//
// createCanopy: the vanilla renderer. Orthographic turntable, render on demand, DOM labels on reserved
// discs, picking without raycasts, and an outline tree for assistive technology.

import * as THREE from "three";
import { fitZoom } from "../core/camera.js";
import { type Violation, checkGuarantees, leafRing, titleScale } from "../core/check.js";
import { type Vec2, contains } from "../core/geometry.js";
import { layoutCanopy, regionNeighbours, resolveParams } from "../core/layout.js";
import { frameOf } from "../core/morph.js";
import type { CanopyLayout, HubInput, Inset, LinkInput, Measure, NodeInput, Params, RegionInput, TuftLayout } from "../core/types.js";
import { OutlineTree, type TreeItem } from "./a11y.js";
import { type CrownBuffers, type LeafBuffers, crownBuffers, disposeObject, groundBuffers, leafBuffers } from "./mesh.js";
import { DEFAULT_STRINGS, type Strings, type Theme, canvasMeasure, resolveTheme } from "./theme.js";
import { DEFAULT_VIEW, type Projection, type Screen, type View, clampView, projection, safeRect, toPlan, toScreen, viewOn, zoomAt } from "./view.js";

export interface CanopyHit {
  type: "node" | "region" | "hub";
  id: string;
}

export type Highlight = Map<string, number> | Set<string> | null;

export interface CanopyOptions {
  regions: RegionInput[];
  nodes: NodeInput[];
  hubs?: HubInput[];
  links?: LinkInput[];
  selected?: string | null;
  /** The lens: a top-level region id, or null for the overview. */
  focus?: string | null;
  /** Search hits: node ids, optionally with weights. Hits keep their colour, the rest dims. */
  highlight?: Highlight;
  view?: Partial<View>;
  /** What panels cover; the grove fits the rest. */
  inset?: Inset;
  theme?: Partial<Theme>;
  strings?: Partial<Strings>;
  reducedMotion?: boolean | "auto";
  /** Show the outline tree as a visible panel instead of only to assistive technology. */
  showOutline?: boolean;
  /** Text sizes in px; default: canvas measureText with the theme fonts. */
  measure?: Measure;
  params?: Partial<Params>;
  onSelect?: (hit: CanopyHit | null) => void;
  onFocusChange?: (id: string | null) => void;
  onViewChange?: (view: View) => void;
  /** Hovered item and its screen position (px, relative to the container), for a tooltip. */
  onHover?: (hit: CanopyHit | null, at: { x: number; y: number } | null) => void;
}

export interface Canopy {
  update(options: Partial<CanopyOptions>): void;
  readonly layout: CanopyLayout | null;
  readonly view: View;
  setView(view: Partial<View>, animate?: boolean): void;
  flyTo(id: string): void;
  resetView(): void;
  /** The guarantee check over a sweep of permitted views for the current layout: [] when nothing can hide anything. */
  checkGuarantees(): Violation[];
  /** Screen position (px, relative to the container) of a node, region or topic; null when unknown. */
  screenOf(id: string): { x: number; y: number } | null;
  dispose(): void;
}

const TAU_MS = 120;
const DIM = 0.78;

export function createCanopy(container: HTMLElement, initial: CanopyOptions): Canopy {
  let opts: CanopyOptions = { ...initial };
  let theme = resolveTheme(opts.theme);
  let strings: Strings = { ...DEFAULT_STRINGS, ...opts.strings };
  let measure: Measure = opts.measure ?? canvasMeasure(theme);
  let layout: CanopyLayout | null = null;
  let nodes = new Map<string, NodeInput>();
  let neighbours = new Map<string, string[]>();
  let selected: string | null = opts.selected ?? null;
  let focus: string | null = opts.focus ?? null;
  let hover: CanopyHit | null = null;
  let treeItem: TreeItem | null = null;
  let disposed = false;

  // ---------------------------------------------------------------- DOM
  const root = document.createElement("div");
  root.style.cssText = `position:relative;width:100%;height:100%;overflow:hidden;background:${theme.paper};outline:none`;
  container.appendChild(root);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, Math.max(1, window.devicePixelRatio || 1)));
  renderer.setClearColor(theme.paper);
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  canvas.setAttribute("aria-hidden", "true");
  canvas.tabIndex = -1;
  root.appendChild(canvas);

  const labelLayer = document.createElement("div");
  labelLayer.setAttribute("aria-hidden", "true");
  labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  root.appendChild(labelLayer);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "path");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke-width", "2");
  ring.setAttribute("stroke-linejoin", "round");
  svg.appendChild(ring);
  root.appendChild(svg);

  const live = document.createElement("div");
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
  root.appendChild(live);

  const tree = new OutlineTree({
    label: strings.label,
    onMove: (item) => {
      treeItem = item;
      announce(item);
      schedule();
    },
    onActivate: (item) => {
      if (item.type === "node") select(item.id);
      else setFocus(item.type === "region" ? item.id : item.region);
    },
    onEscape: () => escape(),
  });
  root.appendChild(tree.el);
  const outlineStyle = () =>
    `position:absolute;left:12px;top:12px;bottom:12px;width:260px;overflow:auto;margin:0;padding:8px 8px 8px 20px;background:${theme.heart};color:${theme.ink};border-radius:12px;font:${theme.fonts.topic};list-style:none`;
  tree.setVisible(Boolean(opts.showOutline), outlineStyle());

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
  scene.add(new THREE.HemisphereLight("#ffffff", "#f1e2de", 2.1));
  const sun = new THREE.DirectionalLight("#fff6f2", 0.95);
  sun.position.set(-60, 140, 40);
  scene.add(sun);
  let world: THREE.Group | null = null;
  let crowns: CrownBuffers | null = null;
  let leaves: LeafBuffers | null = null;

  interface Label {
    el: HTMLDivElement;
    kind: "title" | "topic";
    id: string;
    at: [number, number, number];
    size: { width: number; height: number };
    room: number;
    need: number;
    caption?: HTMLSpanElement;
  }
  let labels: Label[] = [];

  // ---------------------------------------------------------------- view
  const screen: Screen = { width: 1, height: 1, inset: opts.inset ?? { top: 0, right: 0, bottom: 0, left: 0 } };
  const params = () => layout?.params ?? resolveParams(opts.params);
  let view: View = clampView({ ...DEFAULT_VIEW, ...opts.view }, params());
  let target: View = view;
  let last = 0;
  let raf = 0;

  const reduced = () => {
    if (opts.reducedMotion === true || opts.reducedMotion === false) return opts.reducedMotion;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  };

  function setTarget(v: Partial<View>, animate = true) {
    target = clampView({ ...target, ...v, center: v.center ?? target.center }, params());
    if (!animate || reduced()) view = target;
    opts.onViewChange?.(target);
    schedule();
  }

  function schedule() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(frame);
  }

  function frame(now: number) {
    raf = 0;
    if (!layout || disposed) return;
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    const k = 1 - Math.exp(-dt / TAU_MS);
    const settle = (a: number, b: number) => (Math.abs(b - a) < 1e-5 ? b : a + (b - a) * k);
    view = {
      azimuth: settle(view.azimuth, target.azimuth),
      tilt: settle(view.tilt, target.tilt),
      zoom: settle(view.zoom, target.zoom),
      center: [settle(view.center[0], target.center[0]), settle(view.center[1], target.center[1])],
    };
    // The drawn tilt never leaves the permitted range, even mid-animation.
    view.tilt = Math.min(params().maxTilt, Math.max(0, view.tilt));
    draw();
    const moving = view.azimuth !== target.azimuth || view.tilt !== target.tilt || view.zoom !== target.zoom || view.center[0] !== target.center[0] || view.center[1] !== target.center[1];
    if (moving) schedule();
    else last = 0;
  }

  function currentProjection(): Projection {
    return projection(view, screen, params());
  }

  function draw() {
    if (!layout) return;
    const pr = currentProjection();
    const { width: w, height: h } = screen;
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.zoom = pr.z;
    const b = pr.basis;
    // The camera looks at the world point that lands in the middle of the canvas.
    const tr = (w / 2 - pr.ox) / pr.z;
    const tu = (pr.oy - h / 2) / pr.z;
    const T = new THREE.Vector3(b.right[0] * tr + b.up[0] * tu, b.right[1] * tr + b.up[1] * tu, b.right[2] * tr + b.up[2] * tu);
    camera.position.set(T.x + b.d[0] * 1000, T.y + b.d[1] * 1000, T.z + b.d[2] * 1000);
    camera.up.set(b.up[0], b.up[1], b.up[2]);
    camera.lookAt(T);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    placeLabels(pr);
    drawRing(pr);
  }

  // ---------------------------------------------------------------- layout and scene building
  function relayout() {
    if (disposed) return;
    nodes = new Map(opts.nodes.map((n) => [n.id, n]));
    // While a search is on, the hit count takes the caption's place: it is measured with the title, so the
    // heart holds it, and it is about as wide as the caption it replaces, so no region gets folded away by a search.
    const hits = hitCounts();
    const regions = hits ? opts.regions.map((r) => (hits.get(r.id) ? { ...r, caption: strings.hits(hits.get(r.id)!) } : r)) : opts.regions;
    layout = layoutCanopy({ regions, nodes: opts.nodes }, { width: screen.width, height: screen.height, inset: screen.inset }, measure, {
      focus,
      previous: layout,
      params: opts.params,
      more: strings.more,
    });
    if (focus && !layout.regions.some((r) => r.id === focus)) focus = null;
    neighbours = linkNeighbours(opts.links ?? []);
    view = clampView(view, layout.params);
    target = clampView(target, layout.params);
    build();
  }

  function build() {
    if (!layout) return;
    if (world) {
      scene.remove(world);
      disposeObject(world);
    }
    world = new THREE.Group();
    crowns = crownBuffers(frameOf(layout), layout.params, theme);
    world.add(crowns.mesh, crowns.lines);
    leaves = leafBuffers(layout, nodes, theme);
    for (const m of Object.values(leaves.meshes)) world.add(m);
    world.add(groundBuffers(layout, theme));
    scene.add(world);
    buildLabels();
    tree.update(layout, nodes);
    paintLeaves();
    schedule();
  }

  function buildLabels() {
    if (!layout) return;
    labelLayer.textContent = "";
    labels = [];
    const base = "position:absolute;left:0;top:0;white-space:nowrap;text-align:center;will-change:transform;transition:opacity 240ms cubic-bezier(.22,1.1,.36,1)";
    for (const r of layout.regions) {
      const el = document.createElement("div");
      el.style.cssText = `${base};color:${theme.ink}`;
      const b = document.createElement("b");
      b.style.cssText = `display:block;font:${theme.fonts.title};line-height:22px`;
      b.textContent = r.label;
      const span = document.createElement("span");
      span.style.cssText = `display:block;font:${theme.fonts.caption};line-height:14px;letter-spacing:.12em;opacity:.62`;
      span.textContent = r.caption ?? "";
      el.append(b, span);
      labelLayer.appendChild(el);
      labels.push({ el, kind: "title", id: r.id, at: [r.heart.c[0], 0, r.heart.c[1]], size: r.titleSize, room: r.heart.r, need: 0, caption: span });
    }
    for (const t of layout.tufts) {
      if (!t.label || !t.labelSize || !Number.isFinite(t.labelZoom)) continue;
      const el = document.createElement("div");
      el.style.cssText = `${base};font:${theme.fonts.topic};line-height:18px;letter-spacing:.08em;color:${theme.ink};opacity:0`;
      el.textContent = t.label;
      labelLayer.appendChild(el);
      labels.push({ el, kind: "topic", id: t.id, at: [t.crown.c[0], t.crown.height, t.crown.c[1]], size: t.labelSize, room: 0, need: t.labelZoom });
    }
  }

  function hitCounts(): Map<string, number> | null {
    const hl = opts.highlight;
    if (!hl) return null;
    const parent = new Map(opts.regions.map((r) => [r.id, r.parent ?? null]));
    const top = (id: string) => {
      const seen = new Set<string>();
      for (let cur = id; ; ) {
        const up = parent.get(cur);
        if (!up || !parent.has(up) || seen.has(up)) return cur;
        seen.add(cur);
        cur = up;
      }
    };
    const out = new Map<string, number>();
    for (const id of hl.keys()) {
      const n = nodes.get(id);
      if (!n) continue;
      const r = top(n.region);
      out.set(r, (out.get(r) ?? 0) + 1);
    }
    return out;
  }

  function placeLabels(pr: Projection) {
    for (const l of labels) {
      const [x, y] = toScreen(pr, l.at[0], l.at[1], l.at[2]);
      let scale = 1;
      let show = true;
      if (l.kind === "title") scale = titleScale(l.room, pr.z, l.size.width, l.size.height, view.tilt);
      else show = view.zoom >= l.need - 1e-6;
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      l.el.style.opacity = show ? "1" : "0";
    }
  }

  function paintLeaves() {
    if (!leaves) return;
    const hl = opts.highlight;
    const near = selected ? new Set([selected, ...(neighbours.get(selected) ?? [])]) : null;
    const c = new THREE.Color();
    const m = new THREE.Matrix4();
    const grow = new THREE.Matrix4();
    for (const ref of leaves.refs.values()) {
      const mesh = leaves.meshes[ref.shape];
      const lit = (!hl || hl.has(ref.node.id)) && (!near || near.has(ref.node.id)) && ref.node.state !== "muted";
      c.copy(ref.color);
      if (!lit) c.lerp(ref.tone, DIM);
      mesh.setColorAt(ref.index, c);
      if (hover?.type === "node" && hover.id === ref.node.id) {
        // Grow 1.3x about the leaf centre.
        const pos = new THREE.Vector3().setFromMatrixPosition(ref.base);
        grow
          .makeTranslation(pos.x, pos.y, pos.z)
          .multiply(new THREE.Matrix4().makeScale(1.3, 1.3, 1.3))
          .multiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z));
        mesh.setMatrixAt(ref.index, m.multiplyMatrices(grow, ref.base));
      } else mesh.setMatrixAt(ref.index, ref.base);
    }
    for (const mesh of Object.values(leaves.meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    schedule();
  }

  // ---------------------------------------------------------------- focus ring
  function drawRing(pr: Projection) {
    const item = treeItem ?? (selected ? nodeItem(selected) : null);
    const pts = item ? outline(item, pr) : null;
    if (!pts || pts.length < 3) {
      ring.setAttribute("d", "");
      return;
    }
    ring.setAttribute("stroke", theme.accent);
    ring.setAttribute("d", `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`);
  }

  function nodeItem(id: string): TreeItem | null {
    const t = tuftOfNode(id);
    return t ? { type: "node", id, region: t.region, tuft: t.id } : null;
  }

  function outline(item: TreeItem, pr: Projection): Vec2[] | null {
    if (!layout) return null;
    if (item.type === "region") return layout.regions.find((r) => r.id === item.id)?.poly.map((q) => toScreen(pr, q[0], 0, q[1])) ?? null;
    if (item.type === "topic") return layout.tufts.find((t) => t.id === item.id)?.poly.map((q) => toScreen(pr, q[0], 0, q[1])) ?? null;
    const t = layout.tufts.find((x) => x.id === item.tuft);
    const lf = t?.leaves.find((l) => l.node === item.id);
    if (!t || !lf) return null;
    // A ring 3 px outside the leaf: its rim, pushed out from the centre.
    const c = toScreen(pr, lf.p[0], lf.y, lf.p[1]);
    return leafRing(t, lf, 20).map((q) => {
      const s = toScreen(pr, q[0], q[1], q[2]);
      const dx = s[0] - c[0];
      const dy = s[1] - c[1];
      const l = Math.hypot(dx, dy) || 1;
      return [s[0] + (dx / l) * 3, s[1] + (dy / l) * 3] as Vec2;
    });
  }

  // ---------------------------------------------------------------- picking
  function tuftOfNode(id: string): TuftLayout | null {
    return layout?.tufts.find((t) => t.leaves.some((l) => l.node === id)) ?? null;
  }

  type Pick = { type: "node"; id: string; region: string } | { type: "tuft"; id: string; region: string } | { type: "heart"; region: string } | null;

  function pick(sx: number, sy: number, touch: boolean): Pick {
    if (!layout) return null;
    const pr = currentProjection();
    const q = toPlan(pr, sx, sy);
    for (const t of layout.tufts) {
      if (!contains(t.poly, q)) continue;
      const radius = touch ? 22 : 14;
      let best: string | null = null;
      let bestD = radius;
      for (const lf of t.leaves) {
        const s = toScreen(pr, lf.p[0], lf.y, lf.p[1]);
        const d = Math.hypot(s[0] - sx, s[1] - sy);
        if (d < bestD) [best, bestD] = [lf.node, d];
      }
      return best ? { type: "node", id: best, region: t.region } : { type: "tuft", id: t.id, region: t.region };
    }
    for (const r of layout.regions) {
      if (contains(r.heart.poly, q)) return { type: "heart", region: r.id };
      if (contains(r.poly, q)) return { type: "tuft", id: "", region: r.id };
    }
    return null;
  }

  // ---------------------------------------------------------------- actions
  function select(id: string | null) {
    selected = id;
    treeItem = null;
    opts.onSelect?.(id ? { type: "node", id } : null);
    if (id) {
      const n = nodes.get(id);
      const t = tuftOfNode(id);
      const r = layout?.regions.find((x) => x.id === t?.region);
      if (n && r) live.textContent = strings.nodeSummary(n.label ?? n.id, r.label);
      if (t) tree.reveal({ type: "node", id, region: t.region, tuft: t.id });
    }
    paintLeaves();
  }

  function setFocus(id: string | null) {
    if (id === focus) return;
    focus = id;
    opts.onFocusChange?.(id);
    relayout();
    // The lens shows its topic names at the overview zoom.
    setTarget({ zoom: 1, center: [0, 0] });
    const r = id ? layout?.regions.find((x) => x.id === id) : null;
    live.textContent = r ? strings.regionSummary(r.label, r.count, r.tufts.length) : strings.overview;
  }

  function announce(item: TreeItem) {
    if (!layout) return;
    if (item.type === "region") {
      const r = layout.regions.find((x) => x.id === item.id);
      if (r) live.textContent = strings.regionSummary(r.label, r.count, r.tufts.length);
    }
  }

  function escape() {
    if (hover) {
      hover = null;
      opts.onHover?.(null, null);
      paintLeaves();
    } else if (selected) select(null);
    else if (treeItem) {
      treeItem = null;
      schedule();
    } else if (focus) setFocus(null);
  }

  function fly(id: string) {
    if (!layout) return;
    const t = tuftOfNode(id) ?? layout.tufts.find((x) => x.id === id) ?? null;
    if (!t) return;
    const safe = safeRect(screen);
    const p = layout.params;
    // The tuft fills a third of the safe rectangle.
    const zoom = Math.min(safe.w, safe.h) / 3 / (2 * t.crown.r * fitZoom({ width: safe.w, height: safe.h }, target.tilt, p));
    setTarget(viewOn(target, screen, p, t.crown.c[0], t.crown.height, t.crown.c[1], zoom));
  }

  function step(dx: number, dy: number) {
    if (!layout) return;
    const from = treeItem?.type === "region" ? treeItem.id : (focus ?? layout.regions[0]?.id);
    if (!from) return;
    const pr = currentProjection();
    const r0 = layout.regions.find((r) => r.id === from)!;
    const c0 = toScreen(pr, r0.heart.c[0], 0, r0.heart.c[1]);
    let best: string | null = null;
    let bestCos = 0.2;
    for (const id of (regionNeighbourMap ??= regionNeighbours(layout.regions)).get(from) ?? []) {
      const r = layout.regions.find((x) => x.id === id)!;
      const c = toScreen(pr, r.heart.c[0], 0, r.heart.c[1]);
      const vx = c[0] - c0[0];
      const vy = c[1] - c0[1];
      const cos = (vx * dx + vy * dy) / (Math.hypot(vx, vy) || 1);
      if (cos > bestCos) [best, bestCos] = [id, cos];
    }
    if (!best) return;
    treeItem = { type: "region", id: best };
    tree.reveal(treeItem);
    announce(treeItem);
    schedule();
  }
  let regionNeighbourMap: Map<string, string[]> | null = null;

  // ---------------------------------------------------------------- input
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { kind: "turn" | "pan" | "pinch"; x: number; y: number; view: View; dist: number; moved: number; t: number; touch: boolean } | null = null;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const at = local(e);
    pointers.set(e.pointerId, at);
    const touch = e.pointerType === "touch";
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture = { kind: "pinch", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, view: target, dist: Math.hypot(a.x - b.x, a.y - b.y), moved: 99, t: performance.now(), touch };
    } else {
      gesture = { kind: e.button === 2 || e.shiftKey ? "pan" : "turn", x: at.x, y: at.y, view: target, dist: 0, moved: 0, t: performance.now(), touch };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const at = local(e);
    if (!gesture) {
      hoverAt(at.x, at.y, e.pointerType === "touch");
      return;
    }
    pointers.set(e.pointerId, at);
    const p = params();
    if (gesture.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      let v = zoomAt(gesture.view, screen, p, d / Math.max(1, gesture.dist), gesture.x, gesture.y);
      const z = projection(v, screen, p).z;
      v = clampView({ ...v, center: [v.center[0] + (mx - gesture.x) / z, v.center[1] - (my - gesture.y) / z] }, p);
      setTarget(v, false);
      return;
    }
    const dx = at.x - gesture.x;
    const dy = at.y - gesture.y;
    gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
    if (gesture.moved < 3) return;
    if (gesture.kind === "pan") {
      const z = projection(gesture.view, screen, p).z;
      setTarget({ center: [gesture.view.center[0] + dx / z, gesture.view.center[1] - dy / z] }, false);
    } else setTarget({ azimuth: gesture.view.azimuth - dx * 0.006, tilt: gesture.view.tilt - dy * 0.005 }, false);
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    if (g && g.kind !== "pinch" && g.moved < 4 && e.type === "pointerup") click(local(e).x, local(e).y, g.touch);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => {
    if (!gesture && hover) {
      hover = null;
      opts.onHover?.(null, null);
      paintLeaves();
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const at = local(e);
      setTarget(zoomAt(target, screen, params(), Math.exp(-e.deltaY * 0.0015), at.x, at.y));
    },
    { passive: false },
  );
  canvas.addEventListener("dblclick", (e) => {
    const at = local(e);
    const hit = pick(at.x, at.y, false);
    if (hit?.type === "node") fly(hit.id);
    else if (hit?.type === "tuft" && hit.id) fly(hit.id);
  });

  function hoverAt(x: number, y: number, touch: boolean) {
    const hit = pick(x, y, touch);
    const next: CanopyHit | null = hit?.type === "node" ? { type: "node", id: hit.id } : hit?.type === "heart" ? { type: "region", id: hit.region } : null;
    if (next?.id === hover?.id && next?.type === hover?.type) return;
    hover = next;
    canvas.style.cursor = next ? "pointer" : "";
    opts.onHover?.(next, next ? { x, y } : null);
    paintLeaves();
  }

  function click(x: number, y: number, touch: boolean) {
    const hit = pick(x, y, touch);
    if (!hit) {
      select(null);
      return;
    }
    if (hit.type === "node") select(hit.id === selected ? null : hit.id);
    else if (hit.type === "heart" && hit.region === focus) setFocus(null);
    else setFocus(hit.region);
  }

  canvas.addEventListener("keydown", (e) => {
    const p = params();
    let handled = true;
    switch (e.key) {
      case "+":
      case "=":
        setTarget(zoomAt(target, screen, p, 1.25, screen.width / 2, screen.height / 2));
        break;
      case "-":
      case "_":
        setTarget(zoomAt(target, screen, p, 0.8, screen.width / 2, screen.height / 2));
        break;
      case "q":
        setTarget({ azimuth: target.azimuth + Math.PI / 12 });
        break;
      case "e":
        setTarget({ azimuth: target.azimuth - Math.PI / 12 });
        break;
      case "r":
        setTarget({ tilt: target.tilt + Math.PI / 30 });
        break;
      case "f":
        setTarget({ tilt: target.tilt - Math.PI / 30 });
        break;
      case "0":
        resetView();
        break;
      case "ArrowLeft":
        step(-1, 0);
        break;
      case "ArrowRight":
        step(1, 0);
        break;
      case "ArrowUp":
        step(0, -1);
        break;
      case "ArrowDown":
        step(0, 1);
        break;
      case "Enter":
      case " ":
        if (treeItem?.type === "region") setFocus(treeItem.id);
        else if (hover?.type === "node") select(hover.id);
        break;
      case "Escape":
        escape();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => build());

  // ---------------------------------------------------------------- size
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const resize = () => {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === screen.width && h === screen.height) return;
    const first = !layout;
    screen.width = w;
    screen.height = h;
    renderer.setSize(w, h, false);
    if (first) relayout();
    else {
      schedule();
      // Titles are sized for the viewport; recompute once the size has settled.
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayout, 150);
    }
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  ro?.observe(root);
  resize();
  if (!layout) relayout();
  document.fonts?.ready.then(() => {
    if (disposed || opts.measure) return;
    measure = canvasMeasure(theme);
    relayout();
  });

  function resetView() {
    setTarget({ ...DEFAULT_VIEW, ...initial.view });
  }

  return {
    update(next) {
      const prev = opts;
      opts = { ...opts, ...next };
      let needLayout = false;
      let needBuild = false;
      if (next.theme && JSON.stringify(next.theme) !== JSON.stringify(prev.theme)) {
        theme = resolveTheme(opts.theme);
        renderer.setClearColor(theme.paper);
        root.style.background = theme.paper;
        if (!opts.measure) measure = canvasMeasure(theme);
        needLayout = true;
      }
      if (next.strings && !shallowEqual(next.strings, prev.strings)) {
        strings = { ...DEFAULT_STRINGS, ...opts.strings };
        needLayout = true;
      }
      if (next.measure && next.measure !== prev.measure) {
        measure = next.measure;
        needLayout = true;
      }
      if ((next.regions && next.regions !== prev.regions) || (next.nodes && next.nodes !== prev.nodes) || (next.params && JSON.stringify(next.params) !== JSON.stringify(prev.params)))
        needLayout = true;
      if (next.links && next.links !== prev.links) {
        neighbours = linkNeighbours(opts.links ?? []);
        needBuild = true;
      }
      const inset = opts.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
      if ("inset" in next && JSON.stringify(inset) !== JSON.stringify(screen.inset)) {
        screen.inset = inset;
        needLayout = true;
      }
      if ("focus" in next && (next.focus ?? null) !== focus) {
        focus = next.focus ?? null;
        needLayout = true;
        setTarget({ zoom: 1, center: [0, 0] });
      }
      const highlightChanged = "highlight" in next && next.highlight !== prev.highlight;
      if (highlightChanged) needLayout = true;
      if (needLayout) {
        regionNeighbourMap = null;
        relayout();
      } else if (needBuild) paintLeaves();
      if ("selected" in next && (next.selected ?? null) !== selected) {
        selected = next.selected ?? null;
        paintLeaves();
      }
      if (next.view && !sameView(next.view, target)) setTarget(next.view);
      // A new search shows every hit: back to the whole grove.
      if (highlightChanged && next.highlight) setTarget({ zoom: 1, center: [0, 0] });
      if ("showOutline" in next) tree.setVisible(Boolean(opts.showOutline), outlineStyle());
      schedule();
    },
    get layout() {
      return layout;
    },
    get view() {
      return target;
    },
    setView: (v, animate = true) => setTarget(v, animate),
    flyTo(id) {
      const region = layout?.nodeRegion[id];
      if (region && region !== focus) setFocus(region);
      fly(id);
      if (nodes.has(id)) select(id);
    },
    resetView,
    checkGuarantees: () => (layout ? checkGuarantees(layout, undefined, opts.nodes.length) : []),
    screenOf(id) {
      if (!layout) return null;
      const pr = currentProjection();
      const t = tuftOfNode(id);
      const lf = t?.leaves.find((l) => l.node === id);
      if (lf) return xy(toScreen(pr, lf.p[0], lf.y, lf.p[1]));
      const r = layout.regions.find((x) => x.id === id);
      if (r) return xy(toScreen(pr, r.heart.c[0], 0, r.heart.c[1]));
      const tf = layout.tufts.find((x) => x.id === id);
      return tf ? xy(toScreen(pr, tf.crown.c[0], tf.crown.height, tf.crown.c[1])) : null;
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro?.disconnect();
      if (world) disposeObject(world);
      renderer.dispose();
      root.remove();
    },
  };
}

function shallowEqual(a: object, b: object | undefined): boolean {
  if (!b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

const xy = (s: Vec2) => ({ x: s[0], y: s[1] });

function sameView(a: Partial<View>, b: View): boolean {
  return (
    (a.azimuth === undefined || a.azimuth === b.azimuth) &&
    (a.tilt === undefined || a.tilt === b.tilt) &&
    (a.zoom === undefined || a.zoom === b.zoom) &&
    (a.center === undefined || (a.center[0] === b.center[0] && a.center[1] === b.center[1]))
  );
}

function linkNeighbours(links: LinkInput[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of links) {
    (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l.target);
    (out.get(l.target) ?? out.set(l.target, []).get(l.target)!).push(l.source);
  }
  return out;
}
