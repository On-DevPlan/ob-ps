/**
 * tree-zone-body.ts — 折叠/展开 tree zone 的 body(canvas 区域)。
 *
 * 与 applyTreeZoneVisibility 的区别:
 *   - applyTreeZoneVisibility: 控制整个 .merged-zone-tree 的 is-hidden
 *   - toggleTreeBody:          切 .zone-tree-body.is-collapsed 与 (可选).merged-zone-tree.is-shrunk;
 *                             head 保留可见
 *
 * 两者独立:折叠 body 时 zone 仍占位(但高度收缩),utility row 的 is-active 状态不变;
 *           关闭整个 zone 时 DOM 一起清除,下次打开时 body 默认展开。
 *
 * 纯函数 —— 副作用通过 deps 注入,便于单测。
 */

export interface TreeBodyState {
  collapsed: boolean;
}

export interface TreeBodyDeps {
  /** .zone-tree-body 元素 */
  bodyEl: HTMLElement;
  /** head 里的 chevron span,用于 setIcon 翻转图标 */
  chevronEl: HTMLElement;
  /** Obsidian setIcon —— 测试桩记录调用 */
  setIcon: (el: HTMLElement, icon: string) => void;
  /** Optional — toggles .is-shrunk on the zone so the collapsed zone shrinks
   *  to head-only height. Mirrors .merged-zone-wli.is-shrunk pattern. */
  treeZoneEl?: HTMLElement;
}

/**
 * 翻转 body 折叠状态。
 * 副作用:
 *   - bodyEl 加/去 is-collapsed class(canvas 区显隐)
 *   - 提供 treeZoneEl 时,zoneEl 加/去 is-shrunk class(zone 高度收缩)
 *   - chevronEl 图标在 chevron-down ↔ chevron-right 之间翻转
 * 返回:翻转后的状态(便于调用方写回实例字段)。
 */

// Obsidian augments HTMLElement at runtime with toggleClass; mirror it locally
// so we don't import from "obsidian" and stay pure.
interface ObsidianElement {
  toggleClass(cls: string, enabled?: boolean): void;
}
type ObsidianHTMLElement = HTMLElement & ObsidianElement;

export function toggleTreeBody(
  state: TreeBodyState,
  deps: TreeBodyDeps,
): TreeBodyState {
  const nextCollapsed = !state.collapsed;
  const bodyEl = deps.bodyEl as ObsidianHTMLElement;
  bodyEl.toggleClass("is-collapsed", nextCollapsed);
  if (deps.treeZoneEl) {
    (deps.treeZoneEl as ObsidianHTMLElement).toggleClass("is-shrunk", nextCollapsed);
  }
  deps.setIcon(deps.chevronEl, nextCollapsed ? "chevron-right" : "chevron-down");
  return { collapsed: nextCollapsed };
}
