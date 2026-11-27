// SPDX-License-Identifier: AGPL-3.0-or-later
export { findTerritories } from "./territories.js";
export type { Territory, Territories, TerritoryOptions } from "./territories.js";
export type { TerritoryEdge, TerritoryNode } from "./types.js";
export { seeded } from "./random.js";

export { DEFAULT_PARAMS, layoutCanopy, overviewZoom, regionNeighbours, resolveParams } from "./core/layout.js";
export { type CanopyFrame, type FrameRegion, type FrameTuft, frameOf, interpolateLayout } from "./core/morph.js";
export { type CheckView, type Violation, type ViolationKind, checkFrame, checkGuarantees, defaultViews, leafRing, titleScale } from "./core/check.js";
export { type Basis, DEG, dropToPlane, fitZoom, guaranteeHolds, labelDisc, labelDiscPx, project, safeSize, viewBasis, worstSquash } from "./core/camera.js";
export { type Crown, type Facet, type LeafOptions, type LeafSlot, crown, crownHeight, fitPitch, leafSlots } from "./core/crown.js";
export {
  type Circle,
  type Edge,
  type Polygon,
  type Treemap,
  type TreemapItem,
  type Vec2,
  clipHalf,
  contains,
  incircle,
  insetOf,
  insetPoly,
  intersectionArea,
  polyArea,
  polyCentroid,
  polyEdges,
  powerCells,
  reach,
  regularPolygon,
  solveTreemap,
  spiralSites,
} from "./core/geometry.js";
export type * from "./core/types.js";
