// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A seeded, made-up memory for the layout tests: regions of very different sizes, some with many
// topics, some with none. No real content.

import type { HubInput, Measure, NodeInput, RegionInput } from "../../src/index.js";
import { seeded } from "../../src/index.js";

const SPEC: [string, number, string[], boolean?][] = [
  ["home", 120, ["preferences", "routines", "devices", "people"], true],
  ["studio", 300, ["branding", "hosting", "products", "releases", "pipelines", "licences"]],
  ["library", 400, ["reading", "search", "summaries", "archive", "indexes", "highlights", "quotes"]],
  ["workshop", 190, ["tools", "projects", "materials", "safety"]],
  ["garden", 130, ["seeds", "compost", "watering"]],
  ["kitchen", 60, ["recipes", "pantry"]],
  ["travel", 90, ["trains", "packing", "maps"]],
  ["music", 110, ["practice", "gear", "playlists"]],
  ["finance", 70, ["budget", "taxes"]],
  ["health", 95, ["sleep", "training", "food"]],
  ["inbox", 40, []],
];

const LEAF_COLORS = ["#C81040", "#FF2E52", "#FF8FAB", "#FF8FAB", "#FFC2D3"];

export const HUB_NAMES = ["markdown", "calendar", "photos", "spreadsheets", "email", "backups", "printing", "maps", "bikes", "tea", "keyboards", "lamps"];

export function grove(seed = 7, scale = 1): { regions: RegionInput[]; nodes: NodeInput[]; hubs: HubInput[] } {
  const rnd = seeded(seed);
  const regions: RegionInput[] = [];
  const nodes: NodeInput[] = [];
  const hubs: HubInput[] = [];
  for (const [name, n, topics, pin] of SPEC) {
    const total = Math.round(n * scale);
    regions.push({ id: name, parent: null, label: name, caption: `${total} notes`, pin: Boolean(pin) });
    const cuts = topics.length ? topics.map(() => 0.4 + rnd() * 1.6) : [1];
    const sum = cuts.reduce((s, c) => s + c, 0);
    (topics.length ? topics : [null]).forEach((t, k) => {
      const id = t ? `${name}/${t}` : name;
      if (t) regions.push({ id, parent: name, label: t });
      const m = Math.max(4, Math.round((total * cuts[k]!) / sum));
      for (let i = 0; i < m; i++) {
        const x = rnd();
        const shape = x < 0.2 ? "diamond" : x < 0.28 ? "seed" : "leaf";
        const color = shape === "diamond" ? "#B9AEB2" : shape === "seed" ? "#1A1216" : LEAF_COLORS[Math.floor(rnd() * LEAF_COLORS.length)]!;
        nodes.push({ id: `${id}#${i}`, region: id, shape, color, rank: rnd() ** 1.6, t: rnd(), label: `${t ?? name} note ${i}` });
      }
    });
  }
  const tops = SPEC.map((s) => s[0]);
  for (const nm of HUB_NAMES) {
    const k = 2 + Math.floor(rnd() * 4);
    const touch = new Set<string>();
    while (touch.size < k) touch.add(tops[Math.floor(rnd() * tops.length)]!);
    hubs.push({ id: `hub:${nm}`, label: nm, regions: [...touch], weight: 3 + Math.floor(rnd() * 30) });
  }
  return { regions, nodes, hubs };
}

/** Text sizes close to the renderer's fonts, without a DOM. */
export const measure: Measure = (text, role) => {
  if (role === "title") return { width: text.length * 7.6 + 18, height: 22 };
  if (role === "caption") return { width: text.length * 6.1 + 18, height: 14 };
  return { width: text.length * 6.7 + 14, height: 20 };
};
