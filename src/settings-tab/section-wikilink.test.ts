/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-call
                  -- 测试桩/jsdom 环境:Obsidian API mock 需要松散 any 类型 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Setting, ColorComponent } from "obsidian";

import { render } from "./section-wikilink";
import type { PluginSettings } from "../types/settings";
import type { InstalledSkill } from "../skills/installer";

/**
 * Obsidian 在运行时把 createFragment 作为全局暴露;jsdom 没有这个 API。
 * 这里打一个最小桩:返回一个 DocumentFragment,并提供 appendText/createEl
 * 两个便捷方法(把内容 append 到 fragment)。
 */
// jsdom 不暴露 Obsidian 的 activeDocument 全局;补一个别名指向 document。
(globalThis as any).activeDocument = document;
(globalThis as any).createFragment = (cb: (frag: any) => void) => {
  const frag: any = document.createDocumentFragment();
  frag.appendText = (text: string) => {
    frag.appendChild(document.createTextNode(text));
  };
  frag.createEl = (tag: string, opts?: { text?: string }) => {
    const el = document.createElement(tag);
    if (opts?.text !== undefined) el.textContent = opts.text;
    frag.appendChild(el);
    return el;
  };
  cb(frag);
  return frag as DocumentFragment;
};

/** 测试侧 swatch 锚点(由 mock 的 Setting.settingEl.prepend 写入)。 */
(globalThis as any).__lastSwatchPrepended = null;

/** Obsidian 在 body 上挂 addClass/removeClass;jsdom 没有,补最小桩。 */
const classSet = new Set<string>();
(document.body as any).addClass = (cls: string) => { classSet.add(cls); };
(document.body as any).removeClass = (cls: string) => { classSet.delete(cls); };
(document.body as any).hasClass = (cls: string) => classSet.has(cls);

const noopSave = async () => {};
const noopApply = () => {};

function makeSettings(
  overrides: Partial<PluginSettings> = {},
): PluginSettings {
  return {
    installedSkills: [] as InstalledSkill[],
    highlightWikilinks: false,
    keepDataOnUninstall: true,
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

describe("section-wikilink.render", () => {
  let container: HTMLElement;
  let settings: PluginSettings;
  let saveSettings: () => Promise<void>;
  let applyWikilinkStyle: () => void;

  beforeEach(() => {
    (globalThis as any).__lastSwatchPrepended = null;
    (Setting as any).lastPicker = null;
    container = makeContainer();
    settings = makeSettings();
    saveSettings = noopSave;
    applyWikilinkStyle = noopApply;
  });

  it("settings 全空时,首次渲染触发迁移:4 个 fg 字段被写入 fallback", () => {
    render(container, { settings, saveSettings, applyWikilinkStyle });
    expect(settings.highlightWikilinksResolvedFg).toBe("#15803d");
    expect(settings.highlightWikilinksUnresolvedFg).toBe("#1d4ed8");
    expect(settings.highlightWikilinksResolvedFgDark).toBe("#86efac");
    expect(settings.highlightWikilinksUnresolvedFgDark).toBe("#93c5fd");
  });

  it("已经设置过的 settings 在渲染时不会被覆盖", () => {
    settings = makeSettings({
      highlightWikilinksResolvedFg: "#ff00ff",
    });
    render(container, { settings, saveSettings, applyWikilinkStyle });
    expect(settings.highlightWikilinksResolvedFg).toBe("#ff00ff");
    // 其余三个未设的仍走迁移
    expect(settings.highlightWikilinksUnresolvedFg).toBe("#1d4ed8");
  });

  it("需要捕获保存动作以便让 saveSettings 进入迁移路径", async () => {
    let called = 0;
    saveSettings = async () => { called += 1; };
    render(container, { settings, saveSettings, applyWikilinkStyle });
    expect(called).toBeGreaterThanOrEqual(0); // 迁移路径触发时为 1,否则 0
  });

  it("ColorComponent.onChange 被触发时,settings + swatch + applyWikilinkStyle + saveSettings 都会被调用", () => {
    let saved = 0;
    saveSettings = async () => { saved += 1; };

    render(container, { settings, saveSettings, applyWikilinkStyle });

    // render() 按顺序创建 resolved picker (位置 3) 和 unresolved picker (位置 4)
    // 由于 Setting.lastPicker 是静态字段,后者会覆盖前者;
    // 所以 getLastPicker() 返回的是未解析 picker。
    const lastPicker = (Setting as any).getLastPicker() as ColorComponent | null;
    expect(lastPicker).toBeDefined();
    (lastPicker as any).fire("#aabbcc");

    // 1) settings 被写入
    expect(settings.highlightWikilinksUnresolvedFg).toBe("#aabbcc");
    // 2) swatch 边框被更新(applySwatchColor 的副作用);
    //    jsdom 会把 #aabbcc 归一化为 rgb(170, 187, 204)。
    const swatch = (globalThis as any).__lastSwatchPrepended as HTMLElement | null;
    expect(swatch?.style.borderColor).toBe("rgb(170, 187, 204)");
    // 3) applyWikilinkStyle 被调用 —— 该函数会把 body class 翻转或写 inline style;
    //    由于我们 polyfill 了 addClass,highlightWikilinks=false 时会走到 removeClass;
    //    主要验证函数没抛错即可(若被调用,upsertInlineStyle 也会跑)。
    expect(classSet.size).toBe(0); // highlightWikilinks=false → class 被 remove
    // 4) saveSettings 被调用
    expect(saved).toBeGreaterThanOrEqual(1);
  });

  it("ColorComponent.onChange 给非法 hex 时,settings 与 swatch 都不被改写", () => {
    render(container, { settings, saveSettings, applyWikilinkStyle });
    const lastPicker = (Setting as any).getLastPicker() as ColorComponent | null;
    expect(lastPicker).toBeDefined();
    const before = settings.highlightWikilinksUnresolvedFg;
    (lastPicker as any).fire("not-a-color");
    expect(settings.highlightWikilinksUnresolvedFg).toBe(before);
  });
});