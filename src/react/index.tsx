// SPDX-License-Identifier: AGPL-3.0-or-later
//
// <Voronoi3D>: a thin React wrapper over createCanopy. Every stateful prop works controlled
// (pass the value and its onChange) or uncontrolled (pass a default, or nothing).

import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Violation } from "../core/check.js";
import type { CanopyLayout, HubInput, Inset, LinkInput, Measure, NodeInput, Params, RegionInput } from "../core/types.js";
import { type Canopy, type CanopyHit, type Highlight, createCanopy } from "../three/canopy.js";
import type { Strings, Theme } from "../three/theme.js";
import type { View } from "../three/view.js";

export type { CanopyHit, Highlight, Strings, Theme, View };

export interface Voronoi3DHandle {
  flyTo(id: string): void;
  resetView(): void;
  checkGuarantees(): Violation[];
  setView(view: Partial<View>, animate?: boolean): void;
  readonly view: View | null;
  readonly layout: CanopyLayout | null;
}

export interface Voronoi3DProps {
  regions: RegionInput[];
  nodes: NodeInput[];
  hubs?: HubInput[];
  links?: LinkInput[];
  selected?: string | null;
  defaultSelected?: string | null;
  onSelect?: (hit: CanopyHit | null) => void;
  focus?: string | null;
  defaultFocus?: string | null;
  onFocusChange?: (id: string | null) => void;
  highlight?: Highlight;
  view?: Partial<View>;
  defaultView?: Partial<View>;
  onViewChange?: (view: View) => void;
  inset?: Inset;
  theme?: Partial<Theme>;
  strings?: Partial<Strings>;
  reducedMotion?: boolean | "auto";
  showOutline?: boolean;
  measure?: Measure;
  params?: Partial<Params>;
  renderTooltip?: (hit: CanopyHit) => ReactNode;
  className?: string;
  ref?: Ref<Voronoi3DHandle>;
}

export function Voronoi3D(props: Voronoi3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const canopy = useRef<Canopy | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [tip, setTip] = useState<{ hit: CanopyHit; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = latest.current;
    const c = createCanopy(el, {
      regions: p.regions,
      nodes: p.nodes,
      hubs: p.hubs,
      links: p.links,
      selected: p.selected !== undefined ? p.selected : (p.defaultSelected ?? null),
      focus: p.focus !== undefined ? p.focus : (p.defaultFocus ?? null),
      highlight: p.highlight ?? null,
      view: p.view ?? p.defaultView,
      inset: p.inset,
      theme: p.theme,
      strings: p.strings,
      reducedMotion: p.reducedMotion ?? "auto",
      showOutline: p.showOutline,
      measure: p.measure,
      params: p.params,
      onSelect: (hit) => latest.current.onSelect?.(hit),
      onFocusChange: (id) => latest.current.onFocusChange?.(id),
      onViewChange: (v) => latest.current.onViewChange?.(v),
      onHover: (hit, at) => setTip(hit && at && latest.current.renderTooltip ? { hit, ...at } : null),
    });
    canopy.current = c;
    return () => {
      c.dispose();
      canopy.current = null;
    };
  }, []);

  // Controlled props win: after every render the canopy is told the current values.
  useEffect(() => {
    canopy.current?.update({
      regions: props.regions,
      nodes: props.nodes,
      hubs: props.hubs,
      links: props.links,
      highlight: props.highlight ?? null,
      inset: props.inset,
      theme: props.theme,
      strings: props.strings,
      reducedMotion: props.reducedMotion ?? "auto",
      showOutline: props.showOutline,
      measure: props.measure,
      params: props.params,
      ...(props.selected !== undefined ? { selected: props.selected } : {}),
      ...(props.focus !== undefined ? { focus: props.focus } : {}),
      ...(props.view ? { view: props.view } : {}),
    });
  });

  useImperativeHandle(
    props.ref,
    () => ({
      flyTo: (id) => canopy.current?.flyTo(id),
      resetView: () => canopy.current?.resetView(),
      checkGuarantees: () => canopy.current?.checkGuarantees() ?? [],
      setView: (v, animate) => canopy.current?.setView(v, animate),
      get view() {
        return canopy.current?.view ?? null;
      },
      get layout() {
        return canopy.current?.layout ?? null;
      },
    }),
    [],
  );

  return (
    <div ref={host} className={props.className} style={{ position: "relative", width: "100%", height: "100%" }}>
      {tip && props.renderTooltip ? <div style={{ position: "absolute", left: tip.x + 14, top: tip.y + 14, pointerEvents: "none", zIndex: 1 }}>{props.renderTooltip(tip.hit)}</div> : null}
    </div>
  );
}

/** The imperative handle as a hook: `const [ref, api] = useVoronoi3D()`, then `<Voronoi3D ref={ref} />`. */
export function useVoronoi3D(): [Ref<Voronoi3DHandle>, () => Voronoi3DHandle | null] {
  const ref = useRef<Voronoi3DHandle>(null);
  return [ref, () => ref.current];
}
