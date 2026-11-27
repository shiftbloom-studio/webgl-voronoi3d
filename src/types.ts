// SPDX-License-Identifier: AGPL-3.0-or-later

export interface TerritoryNode {
  id: string;
  /** Shown in names and labels. */
  label?: string;
  /** A coarse group the node belongs to (a project, a scope, a folder). Optional. */
  group?: string | null;
  /** Free-form kind, for styling and for `namesFrom`. */
  kind?: string;
}

export interface TerritoryEdge {
  source: string;
  target: string;
  kind?: string;
  /** 0 to 1. Default 1. */
  weight?: number;
}
