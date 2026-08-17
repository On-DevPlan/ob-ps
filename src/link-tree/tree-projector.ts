/**
 * tree-projector.ts — 事件日志 → 树（O(E) 投影）
 *
 * projectTree(events, deps) → TreeNode[]
 *
 * 用 Event Sourcing 的「派生投影」模式：
 *   - parent/children 靠事件自身的 targetPath↔sourcePath 匹配，O(E)，不碰 rows
 *   - status/isStale 靠 Obsidian 的 O(1) 查询（注入 ProjectDeps）
 *   - refs 踢出热路径，延迟到按需计算
 *
 * 身份 key 约定(2026-08 id 化修复):
 *   - byTargetPath 按 child 完整路径(targetPath)索引,与 `sourcePath` 直接比对
 *     即可找到父事件 —— 不再用 basename 去重 / 匹配,杜绝 vault 中两个同名文件
 *     撞 id / 节点坍缩的 bug。
 *
 * 纯函数，注入依赖可测。
 */

import type { CreationEvent } from "./creation-event";
import type { TFile, TAbstractFile } from "obsidian";

// ---- 投影模型（不存储）----

export interface TreeNode {
  /** 对应的事件（附录——本节点来自哪次捕获） */
  event: CreationEvent;
  /** 子节点（派生：事件自身 targetPath↔sourcePath 匹配，不查 rows） */
  children: TreeNode[];
  /** 状态（派生：Obsidian O(1) 查询） */
  status: "created" | "pending";
  /** 源笔记是否被删（派生：Obsidian O(1) 查询） */
  isStale: boolean;
  /** 深度（派生：递归层数） */
  depth: number;
}

// ---- 注入的 Obsidian 查询依赖 ----

export interface ProjectDeps {
  /** target 对应的文件在 vault 中是否存在 */
  isResolved: (target: string, sourcePath: string) => boolean;
  /** sourcePath 对应的文件在 vault 中是否存在 */
  sourceExists: (sourcePath: string) => boolean;
}

// ---- 投影函数 O(E) ----

/**
 * 事件日志 → 树。
 * 复杂度 O(E)，与 vault 链接总数 R 无关。
 * parent/children 靠事件自身匹配，status/isStale 靠 ProjectDeps 的 O(1) 查询。
 *
 * 两遍扫描拓扑挂载(2026-07 修复 ctime-非-拓扑序 bug):
 *   - 第一遍:为每个事件建 TreeNode,全部入 nodeMap(不挂载)
 *   - 第二遍:对每个节点按 byTargetPath(sourcePath) 查父,挂到父下
 *   - attached Set 防重复挂载;自指 parentEvent.id === e.id 排除
 *   - 挂载决策与 firstSeenAt 顺序解耦,ctime 早于父的子节点也能正确归位
 *
 * dedup 语义(2026-08 修复后):
 *   byTargetPath 按 targetPath(完整路径)去重,保留最新 firstSeenAt。
 *   旧算法按 basename 去重 —— 两个同名文件只能保留一个,另一个丢失。
 *
 * @returns 根节点数组（roots），每个 root 递归含 children
 */
export function projectTree(
  events: CreationEvent[],
  deps: ProjectDeps,
): TreeNode[] {
  // 0. 事件索引 byTargetPath:同 targetPath(完整路径)多事件取最新
  const byTargetPath = new Map<string, CreationEvent>();
  for (const e of events) {
    const prev = byTargetPath.get(e.targetPath);
    if (!prev || e.firstSeenAt < prev.firstSeenAt) {
      byTargetPath.set(e.targetPath, e);
    }
  }

  // 1. 第一遍:建全部 TreeNode,入 nodeMap。children 此时为空,depth=0 占位。
  const nodeMap = new Map<string, TreeNode>();
  for (const e of events) {
    nodeMap.set(e.id, {
      event: e,
      children: [],
      status: "pending",
      isStale: false,
      depth: 0,
    });
  }

  // 2. 第二遍:按拓扑挂载。对每个事件查 byTargetPath.get(e.sourcePath):
  //    - parentEvent 存在且 ≠ 自身 → 挂到 parentEvent 对应的 node 下
  //    - 否则 → root
  //    attached Set 防止同一节点被重复挂到多个父(同 targetPath 多事件场景下)。
  //    二环 / 长环天然安全:已 attached 的节点跳过,剩余事件按各自 sourcePath 走
  //    —— 不会形成回到已处理节点的循环(见 plan/2026-07 修复说明)。
  const roots: TreeNode[] = [];
  const attached = new Set<string>();
  for (const e of events) {
    if (attached.has(e.id)) continue;

    const parentEvent = byTargetPath.get(e.sourcePath);

    if (parentEvent && parentEvent.id !== e.id) {
      const parentNode = nodeMap.get(parentEvent.id);
      if (parentNode) {
        parentNode.children.push(nodeMap.get(e.id)!);
        attached.add(e.id);
        continue;
      }
    }
    // 根节点（父不在事件日志里 / 父就是自身 / parent 节点缺失）
    roots.push(nodeMap.get(e.id)!);
  }

  // 3. 修饰每个 node——status/isStale（O(1) 查询）、depth（递归）
  function annotate(node: TreeNode, depth: number): void {
    node.depth = depth;
    node.status = deps.isResolved(node.event.target, node.event.sourcePath)
      ? "created"
      : "pending";
    node.isStale = !deps.sourceExists(node.event.sourcePath);
    for (const child of node.children) {
      annotate(child, depth + 1);
    }
  }
  for (const root of roots) {
    annotate(root, 0);
  }

  return roots;
}

// ---- Obsidian 适配器 ----

/**
 * 把 Obsidian App 折叠成 ProjectDeps。
 * 使用时传入 `makeProjectDeps(app)`。
 *
 * 与 `makeUnresolvedSource(app)` 同款注入模式，保持可测。
 */
export function makeProjectDeps(app: {
  metadataCache: {
    getFirstLinkpathDest(link: string, source: string): TFile | null;
  };
  vault: {
    getAbstractFileByPath(path: string): TAbstractFile | null;
  };
}): ProjectDeps {
  return {
    isResolved(target, sourcePath) {
      return !!app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    },
    sourceExists(sourcePath) {
      return !!app.vault.getAbstractFileByPath(sourcePath);
    },
  };
}
