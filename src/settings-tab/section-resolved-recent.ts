import { Setting } from "obsidian";
import type { PluginSettings } from "../types/settings";

/** 设置标签页需要的插件能力最小集 */
export interface ResolvedRecentSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  /** 改动后通知侧边栏视图即时重渲(可选) */
  notifyResolvedLimitChanged?: () => void;
}

/** 已解析双链数量允许的最小值 */
export const MIN_RESOLVED_RECENT_LIMIT = 1;
/** 已解析双链数量允许的最大值 */
export const MAX_RESOLVED_RECENT_LIMIT = 50;

/**
 * 解析用户输入:必须是整数串(可带负号),否则返回 null。
 * clamp 由调用方负责。
 */
export function parseResolvedRecentLimit(raw: string): number | null {
  if (raw === "") return null;
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return n;
}

/** 把值夹到 [MIN, MAX] */
function clampResolvedRecentLimit(n: number): number {
  if (n < MIN_RESOLVED_RECENT_LIMIT) return MIN_RESOLVED_RECENT_LIMIT;
  if (n > MAX_RESOLVED_RECENT_LIMIT) return MAX_RESOLVED_RECENT_LIMIT;
  return n;
}

/** 渲染「最新已解析双链数量」数值输入设置项 */
export function render(
  containerEl: HTMLElement,
  host: ResolvedRecentSectionHost,
): void {
  new Setting(containerEl)
    .setName("最新已解析双链数量")
    .setDesc("侧边栏「最新已解析双链」区块显示的条数(按目标去重、按创建时间倒序)")
    .addText((text) => {
      text
        .setPlaceholder(`${MIN_RESOLVED_RECENT_LIMIT}-${MAX_RESOLVED_RECENT_LIMIT}`)
        .setValue(String(host.settings.resolvedRecentLimit))
        .onChange((raw) => {
          const parsed = parseResolvedRecentLimit(raw);
          if (parsed === null) {
            // 非法输入:保留之前的值,既不写 settings 也不触发保存/通知。
            return;
          }
          const next = clampResolvedRecentLimit(parsed);
          host.settings.resolvedRecentLimit = next;
          // 把夹紧后的值回写到输入框,保证 UI 与持久值一致。
          text.setValue(String(next));
          void host
            .saveSettings()
            .then(() => host.notifyResolvedLimitChanged?.());
        });
    });
}
