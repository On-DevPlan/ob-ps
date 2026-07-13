/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-member-access
                  -- jsdom + Obsidian mock compatibility helpers require loose any */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
  return {
    ...actual,
    Notice: class {
      constructor(_message: string) {}
    },
  };
});

import { Setting } from "obsidian";
import { render, type LinkTreeSectionHost } from "./section-link-tree";

interface CapturableSetting {
  lastButtons: Array<{
    buttonText: string;
    buttonEl: { classes: string[] };
    fire(): void;
  }>;
  resetCapture(): void;
}
const S = Setting as unknown as CapturableSetting;

function addObsidianDomCompat(el: HTMLElement): HTMLElement {
  (el as any).createEl = (tag: string, opts?: { cls?: string; text?: string }) => {
    const child = document.createElement(tag);
    if (opts?.cls) child.className = opts.cls;
    if (opts?.text !== undefined) child.textContent = opts.text;
    addObsidianDomCompat(child);
    el.appendChild(child);
    return child;
  };
  (el as any).createDiv = (opts?: { cls?: string; text?: string }): HTMLElement => {
    const child = document.createElement("div");
    if (opts?.cls) child.className = opts.cls;
    if (opts?.text !== undefined) child.textContent = opts.text;
    addObsidianDomCompat(child);
    el.appendChild(child);
    return child;
  };
  (el as any).setText = (text: string) => { el.textContent = text; };
  return el;
}

function makeHost(overrides: Partial<LinkTreeSectionHost> = {}): LinkTreeSectionHost {
  return {
    listLinkTreeTopics: () => [{ topicRoot: "root", count: 1, latestScan: 1 }],
    removeLinkTreeTopic: async () => 0,
    clearAllLinkTreeEvents: async () => 1,
    notifyResolvedLimitChanged: () => {},
    refreshSettings: () => {},
    ...overrides,
  };
}

describe("section-link-tree clear-all", () => {
  beforeEach(() => S.resetCapture());

  it("uses the 1.7-compatible mod-warning class", () => {
    render(addObsidianDomCompat(document.createElement("div")), makeHost());
    const clearButton = S.lastButtons.find((b) => b.buttonText === "清空");
    expect(clearButton).toBeDefined();
    expect(clearButton?.buttonEl.classes).toContain("mod-warning");
  });

  it("clears events, notifies, and refreshes settings", async () => {
    const clear = vi.fn(async () => 3);
    const notify = vi.fn();
    const refresh = vi.fn();
    render(addObsidianDomCompat(document.createElement("div")), makeHost({
      clearAllLinkTreeEvents: clear,
      notifyResolvedLimitChanged: notify,
      refreshSettings: refresh,
    }));

    S.lastButtons.find((b) => b.buttonText === "清空")?.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(clear).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
