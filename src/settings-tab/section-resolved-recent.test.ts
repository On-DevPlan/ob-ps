// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Setting } from "obsidian";

import { render } from "./section-resolved-recent";
import type { PluginSettings } from "../types/settings";
import type { InstalledSkill } from "../skills/installer";

/**
 * 真实 `obsidian` 类型声明里没有 lastTexts —— 这是
 * `__mocks__/obsidian.ts` 给测试加的静态捕获字段。tsc 走真实声明,所以这里
 * 把 Setting 收窄成带这个字段的本地类型。运行时由 mock 提供。
 */
interface CapturableSetting {
  lastTexts: {
    getValue(): string;
    placeholder: string;
    fire: (v: string) => void;
  }[];
  resetCapture(): void;
}
const S = Setting as unknown as CapturableSetting;

function makeSettings(
  overrides: Partial<PluginSettings> = {},
): PluginSettings {
  return {
    installedSkills: [] as InstalledSkill[],
    highlightWikilinks: false,
    keepDataOnUninstall: true,
    resolvedRecentLimit: 10,
    commandGroups: [],
    ...overrides,
  };
}

function makeContainer(): HTMLElement {
  return {
    appendChild: () => undefined,
    createEl: () => ({ setText: () => undefined }),
  } as unknown as HTMLElement;
}

describe("section-resolved-recent.render (numeric text input)", () => {
  beforeEach(() => S.resetCapture());

  it("Text input is created with current value as string and placeholder '1-50'", () => {
    const settings = makeSettings({ resolvedRecentLimit: 7 });
    render(makeContainer(), {
      settings,
      saveSettings: async () => {},
    });

    const text = S.lastTexts[0];
    expect(text).toBeDefined();
    expect(text.getValue()).toBe("7");
    expect(text.placeholder).toBe("1-50");
  });

  it("Valid integer input (e.g. '25') saves, writes settings, and notifies after save resolves", async () => {
    const settings = makeSettings({ resolvedRecentLimit: 10 });
    let savedCount = 0;
    let notifyCount = 0;
    const host = {
      settings,
      saveSettings: async () => {
        savedCount += 1;
      },
      notifyResolvedLimitChanged: () => {
        notifyCount += 1;
      },
    };

    render(makeContainer(), host);
    const text = S.lastTexts[0];
    text.fire("25");

    // saveSettings is async (Promise); wait microtask
    await Promise.resolve();

    expect(settings.resolvedRecentLimit).toBe(25);
    expect(savedCount).toBe(1);
    expect(notifyCount).toBe(1);
  });

  it("Out-of-range low input ('0') clamps to 1 and saves", async () => {
    const settings = makeSettings({ resolvedRecentLimit: 10 });
    let savedCount = 0;
    const host = {
      settings,
      saveSettings: async () => {
        savedCount += 1;
      },
      notifyResolvedLimitChanged: () => {},
    };

    render(makeContainer(), host);
    const text = S.lastTexts[0];
    text.fire("0");

    await Promise.resolve();

    expect(settings.resolvedRecentLimit).toBe(1);
    expect(text.getValue()).toBe("1");
    expect(savedCount).toBe(1);
  });

  it("Out-of-range high input ('99') clamps to 50 and saves", async () => {
    const settings = makeSettings({ resolvedRecentLimit: 10 });
    let savedCount = 0;
    const host = {
      settings,
      saveSettings: async () => {
        savedCount += 1;
      },
      notifyResolvedLimitChanged: () => {},
    };

    render(makeContainer(), host);
    const text = S.lastTexts[0];
    text.fire("99");

    await Promise.resolve();

    expect(settings.resolvedRecentLimit).toBe(50);
    expect(text.getValue()).toBe("50");
    expect(savedCount).toBe(1);
  });

  it("Invalid non-numeric input ('abc') keeps previous value, does not save, does not notify", async () => {
    const settings = makeSettings({ resolvedRecentLimit: 10 });
    let savedCount = 0;
    let notifyCount = 0;
    const host = {
      settings,
      saveSettings: async () => {
        savedCount += 1;
      },
      notifyResolvedLimitChanged: () => {
        notifyCount += 1;
      },
    };

    render(makeContainer(), host);
    const text = S.lastTexts[0];
    text.fire("abc");

    await Promise.resolve();

    expect(settings.resolvedRecentLimit).toBe(10);
    expect(savedCount).toBe(0);
    expect(notifyCount).toBe(0);
  });
});
