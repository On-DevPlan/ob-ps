/**
 * creation-event.ts — 完善捕获事件的不可变事实日志
 *
 * 一条 CreationEvent 记录一次完善点击时捕获到的未解析双链。
 * 这是 Event Sourcing 的「事实」原子:append-only、不可变、不含任何派生状态。
 *
 * 身份语义(2026-08 修复后):
 *   - target: display 用的 basename(原 [[]] 链接文本),用户可见
 *   - targetPath: 节点唯一标识(child 笔记完整 vault 路径,如 "前端/工程化.md")
 *     vault 中两个同名文件(test/工程化.md 和 前端/工程化.md)的 targetPath 不同,
 *     整条 link-tree 流水线(evMap / LayoutNode.id / byTargetPath / onJump)
 *     都以 targetPath 为 key,杜绝 basename 碰撞导致的跳错文件 bug。
 *
 * @module link-tree/creation-event
 */

/** 不可变捕获事件 —— 存进 PluginData.linkTree.events */
export interface CreationEvent {
  /** 稳定 id(DOM key / 去重)—— 包含 child 完整路径避免同 topicRoot 下 basename 撞 id */
  id: string;
  /** 未解析双链的目标笔记名(link 文本,如 "工程化")—— 仅供 display 使用,不做 key */
  target: string;
  /** child 笔记完整 vault 路径(如 "前端/工程化.md")—— 节点唯一标识,所有 Map key 都用它 */
  targetPath: string;
  /** 主源笔记路径(触发捕获的 [[]] 所在文件,如 "概率论/知识点.md") */
  sourcePath: string;
  /** 该 [[]] 在源笔记中的位置(跳转锚点) */
  position: { line: number; col: number };
  /** 首次在完善点击时捕获的时间戳 */
  firstSeenAt: number;
  /** 哪次完善点击(按批分组 / 筛选用) */
  runId: string;
  /**
   * 主题根 basename —— 通过 bklink 链向上追溯到的主题归属根节点(如 "前端")。
   * 用于按主题过滤事件,无需运行时再读 frontmatter。
   * undefined 表示旧数据(迁移前)或未分类事件。
   */
  topicRoot?: string;
}

/** 持久化格式:PluginData.linkTree */
export interface LinkTreeStore {
  /** append-only 事件日志 */
  events: CreationEvent[];
  /** schema 版本(迁移用) */
  version: number;
}

/**
 * 默认 schema 版本。
 * v2(2026-08 引入 targetPath 字段):loader 见到 v1 或缺失的 linkTree 数据时清空,
 * 原因:旧数据本身存在 basename 碰撞 bug,迁移等于保留 bug。用户重新 scan 即可。
 */
export const LINK_TREE_VERSION = 2;

// ---- normalize 工具 —— 仅保留 display 用 normalizeTarget;身份 key 改用 targetPath ----

/**
 * 规范化 target:剥离 `#anchor`,保留别名前部分。
 * Obsidian metadataCache 的 link.link 不含 |alias(alias 在 displayText),
 * 但可能带 #anchor(如 "概率论四大公式概念推导#公式 3")→ 剥离。
 * 仅供 display 与 normalize 比对使用;不做身份 key(2026-08 修复后所有 key 用 targetPath)。
 */
export function normalizeTarget(target: string): string {
  return target.replace(/#.*/, "").trim();
}