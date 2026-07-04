/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-call
                  -- 测试桩/jsdom 环境:Obsidian API mock 需要松散 any 类型 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Setting } from "obsidian";

import { render } from "./section-skills";
import type { PluginSettings } from "../types/settings";
import type { InstalledSkill } from "../skills/installer";

/**
 * 真实 `obsidian` 类型声明里没有 lastTexts/lastButtons/resetCapture —— 这些是
 * `__mocks__/obsidian.ts` 给测试加的静态捕获字段。tsc 走真实声明,所以这里
 * 把 Setting 收窄成带这些字段的本地类型。运行时由 mock 提供。
 */
interface CapturableSetting {
  lastTexts: { fire: (v: string) => void; disabled?: boolean }[];
  lastButtons: {
    disabled: boolean;
    tooltip: string;
    icon: string;
    buttonText: string;
    cta: boolean;
    warning: boolean;
    fire: () => void;
  }[];
  resetCapture(): void;
}
const S = Setting as unknown as CapturableSetting;

/**
 * Obsidian 运行时把 createFragment 暴露为全局;jsdom 没有。最小桩:
 * 返回 DocumentFragment,提供 appendText / createEl 把内容 append 上去。
 */
(globalThis as any).createFragment = (cb: (frag: any) => void) => {
  const frag: any = document.createDocumentFragment();
  frag.appendText = (text: string) => {
    frag.appendChild(document.createTextNode(text));
  };
  frag.createEl = (tag: string, opts?: { text?: string; attr?: Record<string, string> }) => {
    const el = document.createElement(tag);
    if (opts?.text !== undefined) el.textContent = opts.text;
    if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
    frag.appendChild(el);
    return el;
  };
  cb(frag);
  return frag as DocumentFragment;
};

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

const noopHostExtras = {
  saveSettings: async (): Promise<void> => {},
  getDefaultCwd: (): string => "/vault",
};

/**
 * render() 内部按顺序创建:1 个说明 Setting(无 addText/addButton)、
 * 1 个 add-row Setting(1 个 addText + 1 个 addButton)、然后每个已装项 1 个 Setting。
 * mock 的 Setting 静态捕获了所有 addText/addButton 创建的组件,按创建顺序。
 */
function renderInto(container: HTMLElement, settings: PluginSettings): void {
  S.resetCapture();
  render(container, { settings, ...noopHostExtras });
}

describe("section-skills add-row", () => {
  beforeEach(() => S.resetCapture());

  it("按钮初始 disabled(源为空)", () => {
    renderInto(document.createElement("div"), makeSettings());
    const button = S.lastButtons[0];
    expect(button).toBeDefined();
    expect(button.disabled).toBe(true);
  });

  it("输入合法源后按钮变为 enabled(响应 onChange)", () => {
    renderInto(document.createElement("div"), makeSettings());
    const text = S.lastTexts[0];
    const button = S.lastButtons[0];
    expect(button.disabled).toBe(true);

    // 模拟用户输入合法源 —— 修复前:按钮依然 disabled(bug)
    text.fire("owner/repo/skills/foo#main");

    expect(button.disabled).toBe(false);
  });

  it("清空输入后按钮再次 disabled", () => {
    renderInto(document.createElement("div"), makeSettings());
    const text = S.lastTexts[0];
    const button = S.lastButtons[0];
    text.fire("owner/repo/skills/foo#main");
    expect(button.disabled).toBe(false);

    text.fire("   ");

    expect(button.disabled).toBe(true);
  });

  it("安装按钮带可见文字「安装」(不靠空 button 识别)", () => {
    renderInto(document.createElement("div"), makeSettings());
    const button = S.lastButtons[0];
    expect(button.buttonText).toBe("安装");
    expect(button.cta).toBe(true);
  });

  it("卸载按钮有可见文字 + trash 图标(不只靠图标识别)", () => {
    const settings = makeSettings({
      installedSkills: [
        { name: "foo", src: "owner/repo/skills/foo#main", dest: "/vault/.claude/skills/foo" },
      ],
    });
    renderInto(document.createElement("div"), settings);

    // lastButtons[0] = add-row 的安装按钮;[1] = 第一个已装项的卸载按钮
    const uninstallButton = S.lastButtons[1];
    expect(uninstallButton).toBeDefined();
    expect(uninstallButton.buttonText).toBe("卸载");
    expect(uninstallButton.icon).toBe("trash");
    expect(uninstallButton.buttonEl.classes).toContain("mod-warning");
  });
});
