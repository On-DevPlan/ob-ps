import { Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";

/** 设置标签页需要的插件能力最小集 */
export interface WikilinkSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  applyWikilinkStyle(): void;
}

/** 渲染「高亮双链样式」toggle 设置项 */
export function render(containerEl: HTMLElement, host: WikilinkSectionHost): void {
  new Setting(containerEl)
    .setName("高亮双链样式")
    .setDesc(
      createFragment((frag) => {
        frag.appendText("开启后,笔记中的内部双链（");
        frag.createEl("code", { text: "[[" });
        frag.appendText(" 链接");
        frag.createEl("code", { text: "]]" });
        frag.appendText("）按解析状态区分高亮:已解析显蓝色,未解析显绿色");
      }),
    )
    .addToggle((t) => {
      t.setValue(host.settings.highlightWikilinks).onChange((v) => {
        host.settings.highlightWikilinks = v;
        host.applyWikilinkStyle();
        void host.saveSettings();
      });
    });

  // 清除双链的快捷键提示
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