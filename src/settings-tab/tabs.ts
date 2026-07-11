/**
 * tabs.ts —— 设置页 tab 元数据与规范化
 *
 * 与 LocalRunnerSettingTab 的耦合点只有 normalizeActiveTab 和 TAB_ORDER。
 * section 模块本身不引用本文件 —— 它们只暴露 render(containerEl, host),
 * 由 index.ts 的 renderProcPane / renderWlPane / renderSkillPane 拼装。
 */

/** 设置页 3 个 tab 的 ID。类型联合,任何超出此集合的字符串视为非法。 */
export type SettingsTabId = "proc" | "wl" | "skill";

/** tab 显示顺序(从左到右)。冻结防止运行时被改。 */
export const TAB_ORDER: readonly SettingsTabId[] = ["proc", "wl", "skill"] as const;

/** tab 显示名(中文)。 */
export const TAB_LABEL: Record<SettingsTabId, string> = {
  proc: "进程命令",
  wl: "双链",
  skill: "skill",
};

/** 默认 tab —— settingsActiveTab 缺省/非法时使用。 */
export const DEFAULT_TAB: SettingsTabId = "proc";

/**
 * 把任意输入规整为合法 SettingsTabId。
 * - undefined / null / 非字符串 / 未知字符串 → DEFAULT_TAB
 * - 合法字符串 → 原样返回
 *
 * 纯函数,无副作用。供 LocalRunnerSettingTab 在 display 时取用,
 * 也供 tests 直接断言。
 */
export function normalizeActiveTab(input: unknown): SettingsTabId {
  if (input === "proc" || input === "wl" || input === "skill") return input;
  return DEFAULT_TAB;
}