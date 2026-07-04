// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { hexToRgbTriplet, upsertInlineStyle } from "./highlight";
import { DEFAULT_SETTINGS } from "../types/settings";

describe("hexToRgbTriplet", () => {
  it("把 #RRGGBB 转成 R G B 三元字符串", () => {
    expect(hexToRgbTriplet("#15803d")).toBe("21 128 61");
  });

  it("接受小写字母", () => {
    expect(hexToRgbTriplet("#1d4ed8")).toBe("29 78 216");
  });

  it("把 #FFFFFF(白)转为 255 255 255", () => {
    expect(hexToRgbTriplet("#FFFFFF")).toBe("255 255 255");
  });

  it("对非法 hex 输入兜底为 0 0 0(黑)", () => {
    expect(hexToRgbTriplet("")).toBe("0 0 0");
    expect(hexToRgbTriplet("#fff")).toBe("0 0 0");        // 短缩
    expect(hexToRgbTriplet("not-a-color")).toBe("0 0 0");
    expect(hexToRgbTriplet("#12345G")).toBe("0 0 0");     // 非法字符
    expect(hexToRgbTriplet("rgb(0,0,0)")).toBe("0 0 0");
  });

  it("剥掉首尾空白后仍能解析", () => {
    expect(hexToRgbTriplet("  #15803d  ")).toBe("21 128 61");
  });
});

function makeDoc(): { doc: Document; head: HTMLElement } {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  return { doc: dom.window.document, head: dom.window.document.head };
}

function makeSettings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("upsertInlineStyle", () => {
  it("highlightWikilinks=false 时移除已有的 inline style 元素", () => {
    const { doc } = makeDoc();
    const el = doc.createElement("style");
    el.id = "ob-ps-hl-wl-inline";
    doc.head.appendChild(el);

    const settings = makeSettings({ highlightWikilinks: false });
    upsertInlineStyle(settings, doc);

    expect(doc.getElementById("ob-ps-hl-wl-inline")).toBeNull();
  });

  it("highlightWikilinks=false 且无 inline 元素时也不报错", () => {
    const { doc } = makeDoc();
    const settings = makeSettings({ highlightWikilinks: false });
    expect(() => upsertInlineStyle(settings, doc)).not.toThrow();
  });

  it("highlightWikilinks=true 时创建 inline style 元素且包含 CM6 未闭合 [[ 规则", () => {
    const { doc } = makeDoc();
    const settings = makeSettings({ highlightWikilinks: true });
    upsertInlineStyle(settings, doc);

    const el = doc.getElementById("ob-ps-hl-wl-inline");
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(".cm-hmd-barelink.cm-link");
  });

  it("fg 全部 undefined 时,fallback 值写入 light 与 dark 两个 selector", () => {
    const { doc } = makeDoc();
    const settings = makeSettings({ highlightWikilinks: true });
    upsertInlineStyle(settings, doc);

    const css = doc.getElementById("ob-ps-hl-wl-inline")!.textContent;
    expect(css).toContain("body.ob-ps-hl-wl");
    expect(css).toContain("--ob-wl-resolved-fg: #15803d");
    expect(css).toContain("--ob-wl-resolved-fg-rgb: 21 128 61");
    expect(css).toContain("--ob-wl-unresolved-fg: #1d4ed8");
    expect(css).toContain("body.ob-ps-hl-wl.theme-dark");
    expect(css).toContain("--ob-wl-resolved-fg: #86efac");
    expect(css).toContain("--ob-wl-resolved-fg-rgb: 134 239 172");
    expect(css).toContain("--ob-wl-unresolved-fg: #93c5fd");
  });

  it("fg 有设置时用 settings 值覆盖 fallback", () => {
    const { doc } = makeDoc();
    const settings = makeSettings({
      highlightWikilinks: true,
      highlightWikilinksResolvedFg: "#ff00ff",
      highlightWikilinksUnresolvedFgDark: "#abcdef",
    });
    upsertInlineStyle(settings, doc);

    const css = doc.getElementById("ob-ps-hl-wl-inline")!.textContent;
    // light 的 resolved 用用户值
    const lightBlock = css.split("body.ob-ps-hl-wl.theme-dark")[0];
    expect(lightBlock).toContain("--ob-wl-resolved-fg: #ff00ff");
    expect(lightBlock).toContain("--ob-wl-resolved-fg-rgb: 255 0 255");
    // dark 的 unresolved 用用户值
    const darkBlock = css.split("body.ob-ps-hl-wl.theme-dark")[1];
    expect(darkBlock).toContain("--ob-wl-unresolved-fg: #abcdef");
    expect(darkBlock).toContain("--ob-wl-unresolved-fg-rgb: 171 205 239");
    // 暗主题的 resolved 仍走 fallback
    expect(darkBlock).toContain("--ob-wl-resolved-fg: #86efac");
  });

  it("第二次调用(onChange 再次触发)会用现有元素替换内容,而不是再 append 一个", () => {
    const { doc } = makeDoc();
    const settings = makeSettings({ highlightWikilinks: true });
    upsertInlineStyle(settings, doc);
    upsertInlineStyle(settings, doc);
    expect(doc.querySelectorAll("#ob-ps-hl-wl-inline").length).toBe(1);
  });
});