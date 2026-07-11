/**
 * link-tree-view.ts — 完善历史树视图桥接
 *
 * 在 merged-view 中挂载的 UI 控制器：创建 canvas、管理全链路更新、
 * 处理作用域过滤、编排折叠状态与 expanded modal 模式。
 *
 * 使用方式（在 merged-view.ts 中）:
 *   private treeView = new TreeLinkView(this.app, callbacks);
 *   buildWliSection() 里: treeView.mount(wliZoneEl);
 *   refreshWli() 末尾:  treeView.update(events, deps);
 */

import { LinkTreeCanvas } from "./link-tree-canvas";
import type { CreationEvent } from "./creation-event";
import { normalizeTarget } from "./creation-event";
import { makeProjectDeps, type ProjectDeps } from "./tree-projector";
import { loadEvents, appendEvents, type HasLinkTree } from "./link-tree-repository";
import type { App } from "obsidian";
import type { BklinkGraph } from "./topic-resolver";
import { findTopicRoot } from "./topic-resolver";

/** 从 vault 相对路径提取 basename,去除 .md 后缀 */
function basenameFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

/**
 * 按当前笔记路径过滤事件到同一主题根（bklink 向上追溯到的根）。
 * 活跃笔记不存在则退化为全部。
 */
export function filterByActiveNote(
  events: CreationEvent[],
  activeNotePath: string | null,
  graph: BklinkGraph,
): CreationEvent[] {
  if (!activeNotePath) return events;
  const activeBasename = basenameFromPath(activeNotePath);
  const activeRoot = findTopicRoot(activeBasename, graph);
  return events.filter((e) => e.topicRoot === activeRoot);
}

// ---- 视图类 ----

export class TreeLinkView {
  private canvas: LinkTreeCanvas;
  private container: HTMLElement | null = null;
  private collapsed: Set<string> = new Set();
  private currentEvents: CreationEvent[] = [];
  private currentDeps: ProjectDeps | null = null;
  private currentActiveNotePath: string | null = null;
  private onJump: ((event: CreationEvent) => void) | null = null;
  /** 折叠状态变化时通知 caller(用于持久化),由 main.ts 提供 */
  private onCollapsedChange: ((topicRoot: string, collapsed: string[]) => void) | null = null;
  /** 当前 active note 的 topicRoot —— 从 events[0]?.topicRoot 派生,
   *  用于 onCollapsedChange 时知道写到 linkTreeCollapsed[哪个主题] */
  private currentTopicRoot: string | null = null;

  /** 注入 openSource 回调（由 merged-view 提供） */
  constructor(
    onJump: (event: CreationEvent) => void,
    options?: {
      initialCollapsed?: string[];
      onCollapsedChange?: (topicRoot: string, collapsed: string[]) => void;
    },
  ) {
    this.canvas = new LinkTreeCanvas();
    this.onJump = onJump;
    if (options?.initialCollapsed) {
      this.collapsed = new Set(options.initialCollapsed);
    }
    if (options?.onCollapsedChange) {
      this.onCollapsedChange = options.onCollapsedChange;
    }
  }

  /** 挂载 canvas 到某个 HTMLElement（如双链检查 zone） */
  mount(container: HTMLElement): void {
    this.container = container;
    this.canvas.mount(container, {
      onJump: (ev) => this.onJump?.(ev),
      onCollapseChange: (s) => {
        this.collapsed = s;
        // 通知 caller(持久化到 linkTreeCollapsed[currentTopicRoot])
        if (this.currentTopicRoot) {
          this.onCollapsedChange?.(this.currentTopicRoot, [...s]);
        }
        // currentEvents 已经过 filterByActiveNote 过滤,折叠/展开只需重绘
        if (this.currentDeps) {
          this.canvas.setCollapsed(this.collapsed);
          this.canvas.update(this.currentEvents, this.currentDeps);
        }
      },
    });
  }

  /** 全链路更新（投影 → 布局 → 绘制）。
 *
 * 注意:本方法假设 events 已经过 filterByActiveNote 过滤。所有 caller
 * (merged-view 的 5 处调用点)在调用 updateFromApp 前都已用真实 graph
 * 过滤过。本方法不再重复过滤——之前因为 updateFromApp 不传 graph,
 * 内部用 EMPTY_GRAPH 二次过滤会把数据全部过滤掉(topicRoot 不匹配)。
 */
  update(
    events: CreationEvent[],
    deps: ProjectDeps,
    activeNotePath?: string | null,
  ): void {
    console.debug("[scan] TreeLinkView.update enter, events=", events.length, "activeNotePath=", activeNotePath);
    this.currentEvents = events;
    this.currentDeps = deps;
    this.currentActiveNotePath = activeNotePath ?? null;
    this.currentTopicRoot = events[0]?.topicRoot ?? null;

    const filtered = events;  // 不再内部过滤,caller 已过滤
    console.debug("[scan] TreeLinkView.update using", filtered.length, "events directly");

    const noteBasename = activeNotePath
      ? (activeNotePath.split("/").pop() ?? "").replace(/\.md$/i, "")
      : "";
    const activeNoteTarget = noteBasename
      ? filtered.find((e) => normalizeTarget(e.target) === noteBasename)?.target ?? null
      : null;
    console.debug("[scan] TreeLinkView.update noteBasename=", noteBasename, "activeNoteTarget=", activeNoteTarget);

    this.canvas.setCollapsed(this.collapsed);
    this.canvas.update(filtered, deps, activeNoteTarget);
    console.debug("[scan] TreeLinkView.update done");
  }

  /** 便捷版本：从 app 构建 deps */
  updateFromApp(
    events: CreationEvent[],
    app: App,
    activeNotePath?: string | null,
  ): void {
    this.update(events, makeProjectDeps(app), activeNotePath);
  }

  /** 重置折叠状态并重算（currentEvents 已经过滤过,直接用） */
  collapseAll(): void {
    this.collapsed = new Set(
      this.currentEvents.map((e) => e.target),
    );
    if (this.currentEvents.length && this.currentDeps) {
      this.canvas.setCollapsed(this.collapsed);
      this.canvas.update(this.currentEvents, this.currentDeps);
    }
  }

  expandAll(): void {
    this.collapsed.clear();
    if (this.currentDeps) {
      this.canvas.setCollapsed(this.collapsed);
      this.canvas.update(this.currentEvents, this.currentDeps);
    }
  }

  /** 切换到全屏 Modal 模式（复用现有 Modal 壳） */
  // （待实现——复用 WikilinkInspectorModal 模式）

  destroy(): void {
    this.canvas.destroy();
    this.container = null;
  }
}

// ---- 仓库便捷函数 ----

export { loadEvents, appendEvents };
export type { HasLinkTree };
