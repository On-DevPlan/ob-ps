import { Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";

/** 设置标签页需要的插件能力最小集 */
export interface ResolvedRecentSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  /** 改动后通知侧边栏视图即时重渲(可选) */
  notifyResolvedLimitChanged?: () => void;
}

/** 渲染「最新已解析双链数量」滑块设置项 */
export function render(
  containerEl: HTMLElement,
  host: ResolvedRecentSectionHost,
): void {
  new Setting(containerEl)
    .setName("最新已解析双链数量")
    .setDesc("侧边栏「最新已解析双链」区块显示的条数(按目标去重、按创建时间倒序)")
    .addSlider((s) => {
      s.setLimits(1, 50, 1)
        .setValue(host.settings.resolvedRecentLimit)
        .onChange((v) => {
          host.settings.resolvedRecentLimit = v;
          void host.saveSettings().then(() => host.notifyResolvedLimitChanged?.());
        });
    });
}
