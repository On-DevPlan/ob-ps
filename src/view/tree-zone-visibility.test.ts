// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTreeZoneVisibility } from "./tree-zone-visibility";

function addClassCompat(el: HTMLElement): HTMLElement {
  const anyEl = el as HTMLElement & {
    addClass?: (cls: string) => void;
    removeClass?: (cls: string) => void;
    toggleClass?: (cls: string, enabled?: boolean) => void;
    setAttr?: (qualifiedName: string, value: string | number | boolean | null) => void;
    setText?: (val: string) => void;
  };
  anyEl.addClass = (cls: string) => el.classList.add(cls);
  anyEl.removeClass = (cls: string) => el.classList.remove(cls);
  anyEl.toggleClass = (cls: string, enabled?: boolean) => {
    el.classList.toggle(cls, enabled);
  };
  anyEl.setAttr = (qualifiedName, value) => {
    if (value === null || value === false) {
      el.removeAttribute(qualifiedName);
    } else {
      el.setAttribute(qualifiedName, String(value));
    }
  };
  anyEl.setText = (val: string) => {
    el.textContent = val;
  };
  return el;
}

describe("applyTreeZoneVisibility", () => {
  it("hides the entire tree zone with no active button state", () => {
    const treeZoneEl = addClassCompat(document.createElement("div"));
    const toggleBtnEl = addClassCompat(document.createElement("button"));
    const iconCalls: string[] = [];

    applyTreeZoneVisibility({
      treeZoneEl,
      toggleBtnEl,
      visible: false,
      setIcon: (_el, icon) => iconCalls.push(icon),
    });

    expect(treeZoneEl.classList.contains("is-hidden")).toBe(true);
    expect(toggleBtnEl.classList.contains("is-active")).toBe(false);
    expect(toggleBtnEl.getAttribute("title")).toBe("显示双链树");
    expect(toggleBtnEl.textContent).toBe("显示双链树");
    expect(iconCalls).toEqual(["git-branch"]);
  });

  it("shows the entire tree zone and marks the button active", () => {
    const treeZoneEl = addClassCompat(document.createElement("div"));
    const toggleBtnEl = addClassCompat(document.createElement("button"));
    const iconCalls: string[] = [];

    applyTreeZoneVisibility({
      treeZoneEl,
      toggleBtnEl,
      visible: true,
      setIcon: (_el, icon) => iconCalls.push(icon),
    });

    expect(treeZoneEl.classList.contains("is-hidden")).toBe(false);
    expect(toggleBtnEl.classList.contains("is-active")).toBe(true);
    expect(toggleBtnEl.getAttribute("title")).toBe("隐藏双链树");
    expect(toggleBtnEl.textContent).toBe("隐藏双链树");
    expect(iconCalls).toEqual(["git-branch"]);
  });
});
