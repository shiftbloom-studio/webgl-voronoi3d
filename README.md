# webgl-voronoi3d

Explore large graphs as named 3D Voronoi territories in WebGL. Related nodes gather into territories, each territory gets a name and a cell, and no cell or label is ever hidden behind another.

> Early development. The first release ships territory detection; the 3D renderer and the React component follow.

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

## Development

```sh
nvm use
npm ci
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE) © shiftbloom studio
