// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A real DOM tree that mirrors the canopy (regions > topics > nodes), with WAI-ARIA tree keys and a
// roving tabindex. The canvas is aria-hidden; this tree is what assistive technology reads and drives.

import type { CanopyLayout, NodeInput } from "../core/types.js";

export type TreeItem = { type: "region"; id: string } | { type: "topic"; id: string; region: string } | { type: "node"; id: string; region: string; tuft: string };

export interface TreeOptions {
  label: string;
  onMove: (item: TreeItem) => void;
  onActivate: (item: TreeItem) => void;
  onEscape: () => void;
}

const HIDDEN = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

export class OutlineTree {
  readonly el: HTMLUListElement;
  private layout: CanopyLayout | null = null;
  private nodes = new Map<string, NodeInput>();
  private expanded = new Set<string>();
  private current: string | null = null;

  constructor(private readonly opts: TreeOptions) {
    this.el = document.createElement("ul");
    this.el.setAttribute("role", "tree");
    this.el.setAttribute("aria-label", opts.label);
    this.el.style.cssText = HIDDEN;
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>("[role=treeitem]");
      if (!li) return;
      this.focusItem(li);
      const item = this.itemOf(li);
      if (item.type !== "node") this.toggle(li);
      this.opts.onActivate(item);
    });
  }

  setVisible(visible: boolean, style = "") {
    this.el.style.cssText = visible ? style : HIDDEN;
  }

  update(layout: CanopyLayout, nodes: Map<string, NodeInput>) {
    this.layout = layout;
    this.nodes = nodes;
    const keep = this.current;
    // A new layout rebuilds the items; keyboard focus stays on the same item.
    const hadFocus = this.el.contains(document.activeElement);
    this.el.textContent = "";
    for (const r of layout.regions) this.el.appendChild(this.regionItem(r.id));
    const first = this.el.querySelector<HTMLLIElement>("[role=treeitem]");
    const again = keep ? this.find(keep) : null;
    (again ?? first)?.setAttribute("tabindex", "0");
    this.current = (again ?? first)?.dataset.key ?? null;
    if (hadFocus) (again ?? first)?.focus();
  }

  /** Moves the tree's focus marker to an item (without taking DOM focus), expanding its ancestors. */
  reveal(item: TreeItem) {
    if (item.type !== "region") this.expand(this.find(`region:${item.region}`));
    if (item.type === "node") {
      const topic = this.find(`topic:${item.tuft}`);
      if (topic) this.expand(topic);
    }
    const li = this.find(keyOf(item));
    if (li) this.setCurrent(li);
  }

  private regionItem(id: string): HTMLLIElement {
    const r = this.layout!.regions.find((x) => x.id === id)!;
    const named = r.tufts.map((t) => this.layout!.tufts.find((x) => x.id === t)!).filter(Boolean);
    const li = this.item(`region:${id}`, 1, r.label + (r.caption ? `, ${r.caption}` : ""), true);
    li.dataset.count = String(named.length);
    return li;
  }

  private item(key: string, level: number, text: string, expandable: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-level", String(level));
    li.setAttribute("tabindex", "-1");
    li.dataset.key = key;
    if (expandable) li.setAttribute("aria-expanded", String(this.expanded.has(key)));
    const span = document.createElement("span");
    span.textContent = text;
    li.appendChild(span);
    if (expandable && this.expanded.has(key)) this.fill(li);
    return li;
  }

  private fill(li: HTMLLIElement) {
    const layout = this.layout!;
    const key = li.dataset.key!;
    const group = document.createElement("ul");
    group.setAttribute("role", "group");
    if (key.startsWith("region:")) {
      const r = layout.regions.find((x) => `region:${x.id}` === key);
      if (!r) return;
      for (const tid of r.tufts) {
        const t = layout.tufts.find((x) => x.id === tid);
        if (!t) continue;
        if (t.label) group.appendChild(this.item(`topic:${t.id}`, 2, `${t.label}, ${t.leaves.length}`, true));
        else for (const lf of t.leaves) group.appendChild(this.item(`node:${lf.node}`, 2, this.nodes.get(lf.node)?.label ?? lf.node, false));
      }
    } else {
      const t = layout.tufts.find((x) => `topic:${x.id}` === key);
      if (!t) return;
      for (const lf of t.leaves) group.appendChild(this.item(`node:${lf.node}`, 3, this.nodes.get(lf.node)?.label ?? lf.node, false));
    }
    li.appendChild(group);
  }

  private expand(li: HTMLLIElement | null) {
    if (!li || li.getAttribute("aria-expanded") !== "false") return;
    this.expanded.add(li.dataset.key!);
    li.setAttribute("aria-expanded", "true");
    this.fill(li);
  }

  private collapse(li: HTMLLIElement) {
    this.expanded.delete(li.dataset.key!);
    li.setAttribute("aria-expanded", "false");
    li.querySelector(":scope > [role=group]")?.remove();
  }

  private toggle(li: HTMLLIElement) {
    if (li.getAttribute("aria-expanded") === "true") this.collapse(li);
    else this.expand(li);
  }

  private find(key: string): HTMLLIElement | null {
    return this.el.querySelector<HTMLLIElement>(`[data-key="${CSS.escape(key)}"]`);
  }

  private visible(): HTMLLIElement[] {
    return [...this.el.querySelectorAll<HTMLLIElement>("[role=treeitem]")].filter((li) => {
      for (let p = li.parentElement?.closest<HTMLLIElement>("[role=treeitem]"); p; p = p.parentElement?.closest<HTMLLIElement>("[role=treeitem]"))
        if (p.getAttribute("aria-expanded") !== "true") return false;
      return true;
    });
  }

  private setCurrent(li: HTMLLIElement) {
    if (this.current) this.find(this.current)?.setAttribute("tabindex", "-1");
    li.setAttribute("tabindex", "0");
    this.current = li.dataset.key!;
  }

  private focusItem(li: HTMLLIElement) {
    this.setCurrent(li);
    li.focus();
    this.opts.onMove(this.itemOf(li));
  }

  itemOf(li: HTMLLIElement): TreeItem {
    const key = li.dataset.key!;
    const id = key.slice(key.indexOf(":") + 1);
    const layout = this.layout!;
    if (key.startsWith("region:")) return { type: "region", id };
    if (key.startsWith("topic:")) return { type: "topic", id, region: layout.tufts.find((t) => t.id === id)?.region ?? "" };
    const tuft = layout.tufts.find((t) => t.leaves.some((l) => l.node === id));
    return { type: "node", id, region: tuft?.region ?? "", tuft: tuft?.id ?? "" };
  }

  private onKey(e: KeyboardEvent) {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>("[role=treeitem]");
    if (!li) return;
    const list = this.visible();
    const i = list.indexOf(li);
    const expandable = li.hasAttribute("aria-expanded");
    const open = li.getAttribute("aria-expanded") === "true";
    const parent = li.parentElement?.closest<HTMLLIElement>("[role=treeitem]") ?? null;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        if (list[i + 1]) this.focusItem(list[i + 1]!);
        break;
      case "ArrowUp":
        if (list[i - 1]) this.focusItem(list[i - 1]!);
        break;
      case "ArrowRight":
        if (expandable && !open) this.expand(li);
        else if (open) {
          const child = li.querySelector<HTMLLIElement>(":scope > [role=group] > [role=treeitem]");
          if (child) this.focusItem(child);
        }
        break;
      case "ArrowLeft":
        if (open) this.collapse(li);
        else if (parent) this.focusItem(parent);
        break;
      case "Home":
        if (list[0]) this.focusItem(list[0]);
        break;
      case "End":
        if (list.at(-1)) this.focusItem(list.at(-1)!);
        break;
      case "Enter":
      case " ":
        this.opts.onActivate(this.itemOf(li));
        break;
      case "Escape":
        this.opts.onEscape();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

export function keyOf(item: TreeItem): string {
  return `${item.type}:${item.id}`;
}
