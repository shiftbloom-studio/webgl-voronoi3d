// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Playground with the seeded sample grove. ?vanilla=1 mounts createCanopy directly instead of the React component.

import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Canopy } from "../src/three/index.js";
import { createCanopy } from "../src/three/index.js";
import { Voronoi3D, type Voronoi3DHandle } from "../src/react/index.js";
import { grove } from "../test/fixtures/grove.js";

const qs = new URLSearchParams(location.search);
const seed = Number(qs.get("seed") ?? 7);
const data = grove(seed, Number(qs.get("scale") ?? 1));
const view = { azimuth: Number(qs.get("az") ?? -35) * (Math.PI / 180), tilt: Number(qs.get("tilt") ?? 46) * (Math.PI / 180) };
const reducedMotion = qs.get("motion") === "0";

declare global {
  interface Window {
    __canopy?: Pick<Canopy, "checkGuarantees" | "flyTo" | "resetView" | "setView" | "layout" | "view"> | Voronoi3DHandle;
  }
}

function App() {
  const ref = useRef<Voronoi3DHandle>(null);
  const [focus, setFocus] = useState<string | null>(qs.get("focus"));
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [outline, setOutline] = useState(false);
  const highlight = useMemo(() => (query.trim() ? new Set(data.nodes.filter((n) => n.label?.includes(query.trim())).map((n) => n.id)) : null), [query]);
  return (
    <>
      <Voronoi3D
        ref={(h) => {
          ref.current = h;
          if (h) window.__canopy = h;
        }}
        regions={data.regions}
        nodes={data.nodes}
        focus={focus}
        onFocusChange={setFocus}
        selected={selected}
        onSelect={(hit) => setSelected(hit?.id ?? null)}
        highlight={highlight}
        defaultView={view}
        reducedMotion={reducedMotion}
        showOutline={outline}
        inset={outline ? { top: 0, right: 0, bottom: 0, left: 284 } : undefined}
        renderTooltip={(hit) => (
          <div className="tip">{hit.type === "node" ? (data.nodes.find((n) => n.id === hit.id)?.label ?? hit.id) : (data.regions.find((r) => r.id === hit.id)?.label ?? hit.id)}</div>
        )}
      />
      <div className="bar">
        <input type="search" placeholder="search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        <button type="button" onClick={() => setFocus(null)} disabled={!focus}>
          overview
        </button>
        <label>
          <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> outline
        </label>
      </div>
    </>
  );
}

const app = document.getElementById("app")!;
if (qs.get("vanilla") === "1") {
  const c = createCanopy(app, { regions: data.regions, nodes: data.nodes, view, reducedMotion, focus: qs.get("focus") });
  window.__canopy = c;
} else {
  createRoot(app).render(<App />);
}
