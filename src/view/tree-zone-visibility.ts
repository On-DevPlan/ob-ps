export interface TreeZoneVisibilityState {
  treeZoneEl: HTMLElement;
  toggleBtnEl: HTMLElement;
  visible: boolean;
  setIcon: (el: HTMLElement, icon: string) => void;
}

/**
 * Obsidian augments the global `Element` interface at runtime with these
 * helpers. The helper deliberately avoids importing from `obsidian` so it
 * stays pure and unit-testable, but the runtime consumers (sidebar view)
 * rely on these methods existing on `HTMLElement`. A local interface mirrors
 * Obsidian's augmentation here so TypeScript accepts the call sites.
 */
interface ObsidianElement {
  toggleClass(cls: string, enabled?: boolean): void;
  setAttr(qualifiedName: string, value: string | number | boolean | null): void;
  setText(val: string): void;
}
type ObsidianHTMLElement = HTMLElement & ObsidianElement;

/**
 * Apply the sidebar tree-zone visibility state.
 *
 * This intentionally toggles a class on the whole tree zone, not on the
 * canvas container, so hidden state removes the tree module from layout.
 */
export function applyTreeZoneVisibility({
  treeZoneEl,
  toggleBtnEl,
  visible,
  setIcon,
}: TreeZoneVisibilityState): void {
  const zone = treeZoneEl as ObsidianHTMLElement;
  const btn = toggleBtnEl as ObsidianHTMLElement;
  const spanEl = toggleBtnEl.querySelector<HTMLElement & ObsidianElement>("span");

  zone.toggleClass("is-hidden", !visible);
  btn.toggleClass("is-active", visible);
  btn.setAttr("title", visible ? "隐藏双链树" : "显示双链树");

  const label = visible ? "隐藏双链树" : "显示双链树";
  if (spanEl) {
    spanEl.setText(label);
  } else {
    btn.setText(label);
  }

  setIcon(toggleBtnEl, "git-branch");
}
