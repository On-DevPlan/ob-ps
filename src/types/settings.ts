import type { CommandGroup } from "./commands";
import type { InstalledSkill } from "../skills/installer";

/**
 * 插件设置(单一来源)
 * main.ts 与 view.ts 都从这里导入,避免重复定义。
 */
export interface PluginSettings {
  /** 已注册安装的 skill 列表。dest 在 boot 时被自校正。 */
  installedSkills: InstalledSkill[];
  /** 是否启用高亮双链样式 */
  highlightWikilinks: boolean;
  /** 用户配置:已解析双链前景色(亮主题)。undefined = 沿用 styles.css fallback */
  highlightWikilinksResolvedFg?: string;
  /** 用户配置:未解析双链前景色(亮主题) */
  highlightWikilinksUnresolvedFg?: string;
  /** 用户配置:已解析双链前景色(暗主题) */
  highlightWikilinksResolvedFgDark?: string;
  /** 用户配置:未解析双链前景色(暗主题) */
  highlightWikilinksUnresolvedFgDark?: string;
  /** 卸载/删除插件时是否保留持久化数据 */
  keepDataOnUninstall: boolean;
  /** 侧边栏「最新已解析双链」区块显示的条数（按目标去重、按创建时间倒序） */
  resolvedRecentLimit: number;
  /** 用户定义的命令组,用于快捷填充新建表单 */
  commandGroups: CommandGroup[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  installedSkills: [],
  highlightWikilinks: false,
  // 4 个 fg 字段默认 undefined:首次打开 settings tab 时再写入
  keepDataOnUninstall: true,
  resolvedRecentLimit: 10,
  commandGroups: [],
};

/** 用户尚未配置时的颜色 fallback(对应 styles.css 当前硬编码值)。
 *  section-wikilink.ts 首次渲染发现字段为 undefined 时回写这些值。 */
export const DEFAULT_FG_VALUES = {
  light: { resolved: "#15803d", unresolved: "#1d4ed8" },
  dark:  { resolved: "#86efac", unresolved: "#93c5fd" },
} as const;
