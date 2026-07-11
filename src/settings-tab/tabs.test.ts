import { describe, it, expect } from "vitest";
import {
  normalizeActiveTab,
  TAB_ORDER,
  TAB_LABEL,
  DEFAULT_TAB,
  type SettingsTabId,
} from "./tabs";

describe("normalizeActiveTab", () => {
  it("undefined → DEFAULT_TAB", () => {
    expect(normalizeActiveTab(undefined)).toBe("proc");
  });

  it("合法字符串原样返回（proc）", () => {
    expect(normalizeActiveTab("proc")).toBe("proc");
  });

  it("合法字符串原样返回（wl）", () => {
    expect(normalizeActiveTab("wl")).toBe("wl");
  });

  it("合法字符串原样返回（skill）", () => {
    expect(normalizeActiveTab("skill")).toBe("skill");
  });

  it("未知字符串 → DEFAULT_TAB", () => {
    expect(normalizeActiveTab("unknown")).toBe("proc");
    expect(normalizeActiveTab("")).toBe("proc");
    expect(normalizeActiveTab("Process")).toBe("proc"); // 大小写敏感
  });

  it("非字符串 → DEFAULT_TAB", () => {
    expect(normalizeActiveTab(42)).toBe("proc");
    expect(normalizeActiveTab(true)).toBe("proc");
    expect(normalizeActiveTab({})).toBe("proc");
    expect(normalizeActiveTab([])).toBe("proc");
  });

  it("null → DEFAULT_TAB", () => {
    expect(normalizeActiveTab(null)).toBe("proc");
  });
});

describe("TAB_ORDER", () => {
  it("严格包含 3 个 tab,顺序为 proc → wl → skill", () => {
    expect(TAB_ORDER).toEqual(["proc", "wl", "skill"]);
    expect(TAB_ORDER.length).toBe(3);
  });
});

describe("TAB_LABEL", () => {
  it("覆盖全部 3 个 tab id", () => {
    const keys = Object.keys(TAB_LABEL).sort();
    expect(keys).toEqual(["proc", "skill", "wl"]);
  });

  it("3 个 id 对应的 label 都是非空字符串", () => {
    const ids: SettingsTabId[] = ["proc", "wl", "skill"];
    for (const id of ids) {
      expect(typeof TAB_LABEL[id]).toBe("string");
      expect(TAB_LABEL[id].length).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_TAB", () => {
  it("固定为 proc", () => {
    expect(DEFAULT_TAB).toBe("proc");
  });
});