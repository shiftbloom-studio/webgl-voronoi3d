// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LabelRole } from "../core/types.js";

export interface Theme {
  paper: string;
  /** Four crown tones; neighbouring regions never share one. */
  tones: [string, string, string, string];
  skirt: string;
  plate: string;
  heart: string;
  ink: string;
  accent: string;
  runner: string;
  trunk: string;
  ground: string;
  /** Default leaf colour for nodes without `color`. */
  leaf: string;
  /** CSS font shorthand per label role, e.g. "600 14px 'General Sans', sans-serif". */
  fonts: Record<LabelRole, string>;
}

export interface Strings {
  /** Accessible name of the whole view. */
  label: string;
  /** Spoken when a region is focused or stepped to. */
  regionSummary: (label: string, count: number, topics: number) => string;
  /** Spoken when a node is selected. */
  nodeSummary: (label: string, region: string) => string;
  /** Caption suffix on a title with search hits. */
  hits: (n: number) => string;
  /** Label of the group region that collects small regions on narrow viewports. */
  more: (n: number) => string;
  overview: string;
}

export const DEFAULT_THEME: Theme = {
  paper: "#F6F1EE",
  tones: ["#FFFBF9", "#FFF3F3", "#FBEBEA", "#FFF7F5"],
  skirt: "#EBD9D6",
  plate: "#F3E6E3",
  heart: "#FFFDFB",
  ink: "#1A1216",
  accent: "#FF2E52",
  runner: "#C81040",
  trunk: "#3A2D32",
  ground: "#EFE7E2",
  leaf: "#FF8FAB",
  fonts: {
    title: "600 14px 'General Sans', system-ui, sans-serif",
    caption: "500 10px 'JetBrains Mono', ui-monospace, monospace",
    topic: "500 11px 'JetBrains Mono', ui-monospace, monospace",
    node: "500 11px 'JetBrains Mono', ui-monospace, monospace",
    hub: "500 11px 'JetBrains Mono', ui-monospace, monospace",
  },
};

export const DEFAULT_STRINGS: Strings = {
  label: "Memory map",
  regionSummary: (label, count, topics) => `${label}: ${count} ${count === 1 ? "item" : "items"} in ${topics} ${topics === 1 ? "topic" : "topics"}`,
  nodeSummary: (label, region) => `${label}, in ${region}`,
  hits: (n) => `${n} ${n === 1 ? "hit" : "hits"}`,
  more: (n) => `${n} more`,
  overview: "Overview",
};

export function resolveTheme(t?: Partial<Theme>): Theme {
  return { ...DEFAULT_THEME, ...t, fonts: { ...DEFAULT_THEME.fonts, ...t?.fonts } };
}

/** Text sizes from canvas measureText with the theme fonts, cached per role and string. Letter spacing is approximated. */
export function canvasMeasure(theme: Theme) {
  const cache = new Map<string, { width: number; height: number }>();
  let ctx: CanvasRenderingContext2D | null = null;
  const spacing: Record<LabelRole, number> = { title: 0, caption: 1.2, topic: 0.9, node: 0.9, hub: 0.9 };
  const pad: Record<LabelRole, [number, number]> = { title: [14, 22], caption: [14, 14], topic: [12, 18], node: [12, 18], hub: [20, 20] };
  return (text: string, role: LabelRole) => {
    const key = `${role}\u0000${text}`;
    let m = cache.get(key);
    if (!m) {
      ctx ??= document.createElement("canvas").getContext("2d");
      let w = text.length * 7.5;
      if (ctx) {
        ctx.font = theme.fonts[role];
        w = ctx.measureText(text).width;
      }
      m = { width: Math.ceil(w + text.length * spacing[role]) + pad[role][0], height: pad[role][1] };
      cache.set(key, m);
    }
    return m;
  };
}
