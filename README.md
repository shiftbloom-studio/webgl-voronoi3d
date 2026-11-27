# webgl-voronoi3d

Explore large graphs as named 3D Voronoi territories in WebGL. Related nodes gather into territories, each territory gets a name and a cell, and no cell or label is ever hidden behind another.

> Early development. The core layout engine, the three.js renderer and the React component are in; the lens morph, the rhizome layer and the time dial follow.

## Install

```sh
npm install @shiftbloom-studio/webgl-voronoi3d
```

## Territories

`findTerritories` splits a graph into territories: seeded Louvain community detection, then a clean-up pass so the result reads as a map (no giant regions, no crumbs, a bounded count). Each territory is named after the nodes its members link to most and other territories link to least.

```ts
import { findTerritories } from "@shiftbloom-studio/webgl-voronoi3d";

const { territories, territoryOf } = findTerritories(nodes, edges, {
  // Which nodes may name a territory, e.g. tags or entities.
  namesFrom: (node) => node.kind === "tag",
  // How strongly an edge ties two nodes together, 0 to 1. `degree` helps weaken hubs.
  tie: (edge, degree) => (edge.weight ?? 1) * Math.min(1, 12 / degree),
  maxTerritories: 36,
});

territories[0]; // { id: 0, name: "Postgres · Migrations", group: "backend", members: [...] }
```

Nodes are `{ id, label?, group?, kind? }`, edges are `{ source, target, kind?, weight? }`. The same graph always gives the same territories.

## Canopy layout

`layoutCanopy` turns regions and nodes into a grove: every top-level region is a crown in one canopy plane, made of a heart (its title) and tufts (its topics); nodes are leaves on the sloped faces of the tufts. The layout is plain, serialisable data, so it can run in a worker and be cached.

```ts
import { checkGuarantees, layoutCanopy } from "@shiftbloom-studio/webgl-voronoi3d";

const layout = layoutCanopy(
  { regions, nodes },
  { width: 1112, height: 792, inset: { top: 0, right: 360, bottom: 0, left: 0 } },
  (text, role) => measureText(text, role), // label sizes in px
  { focus: "library", previous: lastLayout },
);

checkGuarantees(layout); // [] — nothing can hide anything else
```

What it guarantees, at every camera view the renderer allows (orthographic, tilt up to `maxTilt`):

- Cells never overlap, and no crown can cover another: every face is at most `slope` steep and `slope + maxTilt < 90°` (other parameters are refused with a `RangeError`).
- Leaves never overlap and stay on their own crown; every node gets a leaf.
- Region titles fit inside their heart and never touch each other. When a viewport cannot hold every title, the smallest regions are folded into one group region instead of shrinking titles.
- Topic names fit on their table from their `labelZoom` on; in the lens (`focus`) every topic name of the focused region shows at once where the bed has room for it.

`interpolateLayout(a, b, k)` gives the cells and crowns of one morph frame between two layouts (for example into and out of the lens); the same guarantees hold on every frame (`checkFrame`). `checkGuarantees` and `checkFrame` ship in the package so you can assert them in your own tests.

## React

```tsx
import { Voronoi3D } from "@shiftbloom-studio/webgl-voronoi3d/react";

<Voronoi3D
  regions={regions}
  nodes={nodes}
  focus={focus}
  onFocusChange={setFocus}
  selected={selected}
  onSelect={(hit) => setSelected(hit?.id ?? null)}
  highlight={searchHits} // Set or Map of node ids
  inset={{ top: 0, right: 360, bottom: 0, left: 0 }}
  renderTooltip={(hit) => <Tip id={hit.id} />}
  ref={handle} // { flyTo, resetView, setView, checkGuarantees, layout, view }
/>;
```

The component fills its parent. Every stateful prop works controlled (value plus callback) or uncontrolled (`defaultFocus`, `defaultSelected`, `defaultView`). Keep `regions` and `nodes` referentially stable (for example with `useMemo`); a new array means a new layout. Peer dependencies: `react >= 19` and `three >= 0.170`.

Without React, `createCanopy(container, options)` from `@shiftbloom-studio/webgl-voronoi3d/three` takes the same options and returns the same handle plus `update(options)` and `dispose()`.

Controls: drag to turn and tilt, wheel or pinch to zoom at the pointer, right drag or shift drag to pan, click a title to open the lens on its region (again, or Esc, to close it), click a leaf to select it, double click to fly to a topic. Keys on the canvas: `+` `-` zoom, `q` `e` turn, `r` `f` tilt, `0` reset, arrows step to the neighbouring region, Enter opens it. The canvas is hidden from assistive technology; an outline tree (regions, topics, nodes) with WAI-ARIA tree keys mirrors it and drives the lens and the selection (`showOutline` shows it as a panel). The view renders only on input or while it settles.

## Development

```sh
nvm use
npm ci
npm run check
npm run playground    # sample grove at http://localhost:5178 (?vanilla=1 for the plain renderer)
npm run test:browser  # mounts the component in Chromium and checks the guarantees after drag, zoom, lens and search
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE) © shiftbloom studio
