import { Setting } from "obsidian";
import { DEFAULT_FG_VALUES, type PluginSettings } from "../types/settings";
import { applyWikilinkStyle } from "../wikilink/highlight";

/** 设置标签页需要的插件能力最小集 */
export interface WikilinkSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  applyWikilinkStyle(): void;
}

/** 检查并补全 4 个 fg 字段;settings 中已存在的值不会被覆盖。 */
function migrateFgFields(settings: PluginSettings): boolean {
  let mutated = false;
  const next = (
    cur: string | undefined,
    fallback: string,
  ): string => {
    if (typeof cur === "string" && cur.length > 0) return cur;
    mutated = true;
    return fallback;
  };
  settings.highlightWikilinksResolvedFg = next(
    settings.highlightWikilinksResolvedFg,
    DEFAULT_FG_VALUES.light.resolved,
  );
  settings.highlightWikilinksUnresolvedFg = next(
    settings.highlightWikilinksUnresolvedFg,
    DEFAULT_FG_VALUES.light.unresolved,
  );
  settings.highlightWikilinksResolvedFgDark = next(
    settings.highlightWikilinksResolvedFgDark,
    DEFAULT_FG_VALUES.dark.resolved,
  );
  settings.highlightWikilinksUnresolvedFgDark = next(
    settings.highlightWikilinksUnresolvedFgDark,
    DEFAULT_FG_VALUES.dark.unresolved,
  );
  return mutated;
}

/**
 * 创建 16×16 预览色块;边框色由调用方写入 style.borderColor。
 * 返回 swatch 元素以便 onChange 中更新边框。
 */
function createSwatch(): HTMLElement {
  const el = activeDocument.createElement("span");
  el.className = "ob-ps-color-swatch";
  return el;
}

/** 把 hex 套到 swatch 边框上(非法 hex 不动,保留上一次状态) */
function applySwatchColor(swatch: HTMLElement, hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return;
  swatch.style.borderColor = hex;
}

/** 渲染「高亮双链样式」区段 */
export function render(containerEl: HTMLElement, host: WikilinkSectionHost): void {
  // 1) 首次打开迁移:补全 fg 字段
  const mutated = migrateFgFields(host.settings);
  if (mutated) {
    void host.saveSettings();
  }

  // 2) 顶部开关:保留,见 spec §2 备注
  new Setting(containerEl)
    .setName("高亮双链样式")
    .setDesc(
      createFragment((frag) => {
        frag.appendText("开启后,笔记中的内部双链（");
        frag.createEl("code", { text: "[[" });
        frag.appendText(" 链接");
        frag.createEl("code", { text: "]]" });
        frag.appendText("）按解析状态区分高亮;颜色可在此区段下方的两个色板中自定义");
      }),
    )
    .addToggle((t) => {
      t.setValue(host.settings.highlightWikilinks).onChange((v) => {
        host.settings.highlightWikilinks = v;
        host.applyWikilinkStyle();
        void host.saveSettings();
      });
    });

  // 3) 已解析双链 fg
  const resolvedSwatch = createSwatch();
  applySwatchColor(resolvedSwatch, host.settings.highlightWikilinksResolvedFg!);
  new Setting(containerEl)
    .setName("已解析双链颜色")
    .setDesc("内部双链([[链接]])目标存在时的文字与边框颜色")
    .addColorPicker((cp) => {
      cp.setValue(host.settings.highlightWikilinksResolvedFg!)
        .onChange((v) => {
          if (!/^#[0-9a-fA-F]{6}$/.test(v.trim())) return;
          host.settings.highlightWikilinksResolvedFg = v;
          applySwatchColor(resolvedSwatch, v);
          applyWikilinkStyle(host.settings);
          void host.saveSettings();
        });
    })
    .settingEl.prepend(resolvedSwatch);

  // 4) 未解析双链 fg
  const unresolvedSwatch = createSwatch();
  applySwatchColor(unresolvedSwatch, host.settings.highlightWikilinksUnresolvedFg!);
  new Setting(containerEl)
    .setName("未解析双链颜色")
    .setDesc("内部双链([[链接]])目标不存在时的文字与边框颜色")
    .addColorPicker((cp) => {
      cp.setValue(host.settings.highlightWikilinksUnresolvedFg!)
        .onChange((v) => {
          if (!/^#[0-9a-fA-F]{6}$/.test(v.trim())) return;
          host.settings.highlightWikilinksUnresolvedFg = v;
          applySwatchColor(unresolvedSwatch, v);
          applyWikilinkStyle(host.settings);
          void host.saveSettings();
        });
    })
    .settingEl.prepend(unresolvedSwatch);

  // 5) 原有「清除双链」说明保留(本次未改)
  new Setting(containerEl)
    .setName("清除双链")
    .setDesc(
      createFragment((frag) => {
        frag.appendText("在当前笔记中把全部 ");
        frag.createEl("code", { text: "[[" });
        frag.appendText(" 双链转为 ");
        frag.createEl("code", { text: "[" });
        frag.appendText(" 单链。运行命令面板的「将当前笔记的双链转为单链」，或在 ");
        frag.createEl("code", { text: "设置 → 热键" });
        frag.appendText(" 中绑定快捷键");
      }),
    );
}