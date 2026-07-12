// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { toggleTreeBody } from "./tree-zone-body";

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

describe("toggleTreeBody", () => {
  it("flips collapsed from false to true and adds is-collapsed class", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    const chevronEl = document.createElement("span");
    const setIcon = vi.fn();

    const next = toggleTreeBody(
      { collapsed: false },
      { bodyEl, chevronEl, setIcon },
    );

    expect(next.collapsed).toBe(true);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), "chevron-right");
  });

  it("flips collapsed from true to false and removes is-collapsed class", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    bodyEl.classList.add("is-collapsed");
    const chevronEl = document.createElement("span");
    const setIcon = vi.fn();

    const next = toggleTreeBody(
      { collapsed: true },
      { bodyEl, chevronEl, setIcon },
    );

    expect(next.collapsed).toBe(false);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(false);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), "chevron-down");
  });

  it("does not touch tree-zone is-hidden class (independent of zone visibility)", () => {
    const treeZoneEl = document.createElement("div");
    const bodyEl = addClassCompat(document.createElement("div"));
    treeZoneEl.appendChild(bodyEl);
    treeZoneEl.classList.add("is-hidden");

    toggleTreeBody(
      { collapsed: false },
      {
        bodyEl,
        chevronEl: document.createElement("span"),
        setIcon: vi.fn(),
      },
    );

    expect(treeZoneEl.classList.contains("is-hidden")).toBe(true);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(true);
  });

  it("does not toggle scan button is-loading class", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    const scanBtn = document.createElement("div");
    scanBtn.classList.add("tree-scan-btn");
    scanBtn.classList.add("is-loading");
    bodyEl.appendChild(scanBtn);

    toggleTreeBody(
      { collapsed: false },
      {
        bodyEl,
        chevronEl: document.createElement("span"),
        setIcon: vi.fn(),
      },
    );

    expect(scanBtn.classList.contains("is-loading")).toBe(true);
    expect(bodyEl.classList.contains("is-loading")).toBe(false);
  });

  it("idempotent on consecutive calls (returns to original state)", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    const chevronEl = document.createElement("span");
    const setIcon = vi.fn();
    const deps = { bodyEl, chevronEl, setIcon };

    const a = toggleTreeBody({ collapsed: false }, deps);
    const b = toggleTreeBody(a, deps);

    expect(b.collapsed).toBe(false);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(false);
  });

  it("toggles is-shrunk on treeZoneEl when provided", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    const treeZoneEl = addClassCompat(document.createElement("div"));
    const setIcon = vi.fn();

    const next = toggleTreeBody(
      { collapsed: false },
      {
        bodyEl,
        chevronEl: document.createElement("span"),
        setIcon,
        treeZoneEl,
      },
    );

    expect(next.collapsed).toBe(true);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(true);
    expect(treeZoneEl.classList.contains("is-shrunk")).toBe(true);

    // Re-expand — both classes should be removed.
    const next2 = toggleTreeBody(
      next,
      {
        bodyEl,
        chevronEl: document.createElement("span"),
        setIcon,
        treeZoneEl,
      },
    );

    expect(next2.collapsed).toBe(false);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(false);
    expect(treeZoneEl.classList.contains("is-shrunk")).toBe(false);
  });

  it("works without treeZoneEl (optional, backward-compatible)", () => {
    const bodyEl = addClassCompat(document.createElement("div"));
    const setIcon = vi.fn();

    // No treeZoneEl — should not throw, body should still collapse.
    const next = toggleTreeBody(
      { collapsed: false },
      {
        bodyEl,
        chevronEl: document.createElement("span"),
        setIcon,
      },
    );

    expect(next.collapsed).toBe(true);
    expect(bodyEl.classList.contains("is-collapsed")).toBe(true);
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), "chevron-right");
  });
});
