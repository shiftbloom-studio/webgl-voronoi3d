// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Buffers for one canopy: crowns, hearts, plates and skirts as one flat-shaded mesh, facet lines,
// instanced leaves, the ground and the trunks. Plan (x, y) is world (x, z); height is world y.

import * as THREE from "three";
import type { Vec2 } from "../core/geometry.js";
import type { CanopyFrame } from "../core/morph.js";
import type { CanopyLayout, LeafLayout, NodeInput, Params } from "../core/types.js";
import type { Theme } from "./theme.js";

const V = (q: Vec2, h: number): [number, number, number] => [q[0], h, q[1]];

export interface CrownBuffers {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

/** Crowns, hearts, plates and skirts of a frame (a layout at rest, or one step of a morph). */
export function crownBuffers(frame: CanopyFrame, p: Params, theme: Theme, reuse?: CrownBuffers): CrownBuffers {
  const pos: number[] = [];
  const col: number[] = [];
  const line: number[] = [];
  const c3 = new THREE.Color();
  const tri = (a: number[], b: number[], c: number[], color: THREE.Color) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], color: THREE.Color) => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };
  const tone = new Map(frame.regions.map((r) => [r.id, new THREE.Color(theme.tones[r.tone % 4])]));
  const skirt = new THREE.Color(theme.skirt);
  const plate = new THREE.Color(theme.plate);
  const heart = new THREE.Color(theme.heart);
  const lift = (v: number[]) => [v[0]!, v[1]! + 0.02, v[2]!];

  for (const t of frame.tufts) {
    const cr = t.crown;
    const color = tone.get(t.region) ?? c3.set(theme.tones[0]);
    for (const f of cr.facets) {
      const up = (q: Vec2) => V(q, cr.tan * Math.max(0, Math.min(cr.d0, f.nx * (q[0] - f.a[0]) + f.ny * (q[1] - f.a[1]))));
      const m = f.poly.length;
      for (let j = 1; j < m - 1; j++) tri(up(f.poly[0]!), up(f.poly[j + 1]!), up(f.poly[j]!), color);
      for (let j = 0; j < m; j++) line.push(...lift(up(f.poly[j]!)), ...lift(up(f.poly[(j + 1) % m]!)));
    }
    for (let j = 1; j < cr.table.length - 1; j++) tri(V(cr.table[0]!, cr.height), V(cr.table[j + 1]!, cr.height), V(cr.table[j]!, cr.height), color);
    const n = t.poly.length;
    for (let j = 0; j < n; j++) {
      const a = t.poly[j]!;
      const b = t.poly[(j + 1) % n]!;
      quad(V(a, -p.skirt), V(a, 0), V(b, 0), V(b, -p.skirt), skirt);
    }
  }
  for (const r of frame.regions) {
    // A plate under each region closes the gaps between its own tufts; only the gaps between regions stay open.
    const m = r.poly.length;
    const c = r.heart.c;
    for (let j = 0; j < m; j++) tri(V(c, -p.skirt * 0.55), V(r.poly[(j + 1) % m]!, -p.skirt * 0.55), V(r.poly[j]!, -p.skirt * 0.55), plate);
    const h = r.heart.poly;
    for (let j = 0; j < h.length; j++) {
      const a = h[j]!;
      const b = h[(j + 1) % h.length]!;
      tri(V(r.heart.c, 0), V(b, 0), V(a, 0), heart);
      quad(V(a, -p.skirt), V(a, 0), V(b, 0), V(b, -p.skirt), skirt);
      line.push(...V(a, 0.02), ...V(b, 0.02));
    }
  }

  const out = reuse ?? {
    mesh: new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    ),
    lines: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: theme.ink, transparent: true, opacity: 0.16 })),
  };
  out.mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.mesh.geometry.computeVertexNormals();
  out.mesh.geometry.computeBoundingSphere();
  out.lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(line, 3));
  out.lines.geometry.computeBoundingSphere();
  return out;
}

/** A pointed leaf inside the unit ellipse: two parabola arcs that meet in a tip at both ends. */
function almond(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const x = -1 + (2 * i) / N;
    if (i) shape.lineTo(x, 1 - x * x);
    else shape.moveTo(x, 1 - x * x);
  }
  for (let i = N - 1; i >= 0; i--) {
    const x = -1 + (2 * i) / N;
    shape.lineTo(x, -(1 - x * x));
  }
  return new THREE.ShapeGeometry(shape);
}

export type LeafShape = "leaf" | "diamond" | "seed";

export interface LeafRef {
  leaf: LeafLayout;
  node: NodeInput;
  shape: LeafShape;
  index: number;
  base: THREE.Matrix4;
  color: THREE.Color;
  tone: THREE.Color;
}

export interface LeafBuffers {
  meshes: Record<LeafShape, THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>;
  refs: Map<string, LeafRef>;
}

/** One instanced mesh per leaf shape. Each leaf lies flat on its face, lifted a little along the normal. */
export function leafBuffers(layout: CanopyLayout, nodes: Map<string, NodeInput>, theme: Theme): LeafBuffers {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const geometry: Record<LeafShape, THREE.BufferGeometry> = { leaf: almond(), diamond: new THREE.CircleGeometry(1, 4), seed: new THREE.CircleGeometry(1, 14) };
  const groups: Record<LeafShape, LeafRef[]> = { leaf: [], diamond: [], seed: [] };
  const refs = new Map<string, LeafRef>();
  const regionTone = new Map(layout.regions.map((r) => [r.id, new THREE.Color(theme.tones[r.tone % 4])]));
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3();
  const ez = new THREE.Vector3();
  for (const t of layout.tufts) {
    for (const lf of t.leaves) {
      const node = nodes.get(lf.node);
      if (!node) continue;
      const shape: LeafShape = node.shape ?? "leaf";
      const f = t.crown.facets[lf.facet]!;
      const k = shape === "seed" ? 0.62 : 1;
      const a = shape === "seed" ? lf.b : lf.a;
      ex.set(f.nx, f.slope, f.ny).multiplyScalar((a / 2) * k);
      ey.set(f.tx, 0, f.ty).multiplyScalar((lf.b / 2) * k);
      ez.crossVectors(ex, ey).normalize();
      if (ez.y < 0) ez.negate();
      const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
      m.setPosition(lf.p[0] + ez.x * 0.06, lf.y + ez.y * 0.06, lf.p[1] + ez.z * 0.06);
      const ref: LeafRef = {
        leaf: lf,
        node,
        shape,
        index: groups[shape].length,
        base: m,
        color: new THREE.Color(node.color ?? theme.leaf),
        tone: regionTone.get(t.region) ?? new THREE.Color(theme.tones[0]),
      };
      groups[shape].push(ref);
      refs.set(lf.node, ref);
    }
  }
  const meshes = {} as LeafBuffers["meshes"];
  for (const shape of ["leaf", "diamond", "seed"] as const) {
    const list = groups[shape];
    const mesh = new THREE.InstancedMesh(geometry[shape], material, Math.max(1, list.length));
    mesh.count = list.length;
    for (const r of list) {
      mesh.setMatrixAt(r.index, r.base);
      mesh.setColorAt(r.index, r.color);
    }
    mesh.frustumCulled = false;
    meshes[shape] = mesh;
  }
  return { meshes, refs };
}

/** The ground disc and the trunks: one stick from the ground to a fork, one from the fork to each tuft and the heart. */
export function groundBuffers(layout: CanopyLayout, theme: Theme): THREE.Group {
  const p = layout.params;
  const group = new THREE.Group();
  const groundY = -p.trunk;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(p.bedRadius, 96), new THREE.MeshBasicMaterial({ color: theme.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  group.add(ground);
  const sticks: [THREE.Vector3, THREE.Vector3, number][] = [];
  const tuftById = new Map(layout.tufts.map((t) => [t.id, t]));
  for (const r of layout.regions) {
    const base = new THREE.Vector3(r.c[0], groundY, r.c[1]);
    const fork = new THREE.Vector3(r.c[0], groundY + p.trunk * 0.5, r.c[1]);
    sticks.push([base, fork, 0.95]);
    for (const id of r.tufts) {
      const t = tuftById.get(id);
      if (t) sticks.push([fork, new THREE.Vector3(t.crown.c[0], -p.skirt, t.crown.c[1]), 0.4]);
    }
    sticks.push([fork, new THREE.Vector3(r.heart.c[0], -p.skirt, r.heart.c[1]), 0.4]);
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.75, 1, 1, 7, 1, true), new THREE.MeshBasicMaterial({ color: theme.trunk }), Math.max(1, sticks.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  sticks.forEach(([a, b, r], i) => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    q.setFromUnitVectors(yAxis, dir.normalize());
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
    trunks.setMatrixAt(i, m);
  });
  trunks.count = sticks.length;
  trunks.frustumCulled = false;
  group.add(trunks);
  return group;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((x) => {
    const any = x as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    any.geometry?.dispose();
    if (Array.isArray(any.material)) any.material.forEach((m) => m.dispose());
    else any.material?.dispose();
  });
}
