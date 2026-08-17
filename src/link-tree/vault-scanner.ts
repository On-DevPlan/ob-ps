/**
 * vault-scanner.ts — 从 vault 当前状态扫描指定主题的 CreationEvent
 *
 * 与 snapshot-hook 的关系:本模块取代了之前基于 "snapshotEnabled 进程"
 * 的事件捕获。现在事件由用户主动点击触发,数据来自 vault 实时 bklink
 * 拓扑,不再是进程启动时的「未解析链接快照」。
 *
 * 关键设计(2026-08 id 化):
 *   - 每个事件的 targetPath 字段写入 child 文件的完整 vault 路径,
 *     保证整条 link-tree 流水线以"完整路径"为 key,杜绝 basename 碰撞。
 *   - event.id 也包含 child 完整路径,避免 S9 描述的同 topicRoot 同
 *     basename 同 bklink-index 撞 id 场景。
 */

import type { App } from "obsidian";
import type { CreationEvent } from "./creation-event";
import {
  buildBklinkGraph,
  findTopicRoot,
  getTopicSubgraph,
  type BklinkGraph,
} from "./topic-resolver";

/** vault-scan 事件的固定 runId,用于区分其他来源 */
const VAULT_SCAN_RUN_ID = "vault-scan";

/** bklink 扫描无法恢复源码位置,用 (0,0) 占位 */
const ZERO_POSITION = { line: 0, col: 0 } as const;

export interface ScanResult {
  /** 扫描到的主题根 basename */
  topicRoot: string;
  /** 该主题下生成的 CreationEvent[] */
  events: CreationEvent[];
  /** 主题子图包含的节点数(用于 Notice 反馈) */
  nodeCount: number;
}

/**
 * 扫描当前活动笔记所属主题的完整子图。
 * 入口方法——main.ts 在用户点击 icon button 时调用。
 *
 * 2026-08 id 化修复:用 activeNotePath(完整 vault 路径)而不是 basename
 * 找 topicRoot。两个同名文件会走各自独立的 bklink 链,不会再 bleed。
 *
 * @param app            Obsidian App
 * @param activeNotePath 当前活动笔记的 vault 相对路径,如 "前端/js的emit底层原理.md"
 */
export async function scanActiveNoteTopic(
  app: App,
  activeNotePath: string,
): Promise<ScanResult> {
  const graph = buildBklinkGraph(app);
  // 用完整路径找 topicRoot,避免两个同名文件撞图节点(2026-08 修复)
  const topicRoot = findTopicRoot(activeNotePath, graph);
  return scanTopicEvents(app, topicRoot, graph);
}

/**
 * 扫描指定根主题,生成该主题所有节点的 bklink 边作为 CreationEvent。
 *
 * 事件方向(关键):
 *   target     = 当前笔记名 (子/依赖者)
 *   targetPath = 当前笔记完整 vault 路径 (子节点身份,2026-08 修复后所有 key 用它)
 *   sourcePath = bklink 前置笔记的 path (父/被依赖者)
 *
 * 这样 projectTree (source=父, targetPath=子) 会把 bklink 前置当作根,
 * 当前笔记当作子节点。知识点(bklink 空)无事件以它为 target,自然成为 ghost 根。
 *
 * 2026-08 id 化修复:topicRoot 现在是「文件完整路径」(从 findTopicRoot(activePath) 返回),
 * 用来调 getTopicSubgraph(path, graph) 取主题子图。subgraph 内的每个节点
 * 都按 path 找 file(用 fileByPath),避免 basename 碰撞。
 *
 * 纯函数除 vault 读之外无副作用——测试可注入 mock app。
 *
 * @param app       Obsidian App,用于读 vault 文件元数据
 * @param topicRoot 主题根路径(2026-08 修复后)
 * @param graph     预先构建的 bklink 邻接表
 */
export function scanTopicEvents(
  app: App,
  topicRoot: string,
  graph: BklinkGraph,
): ScanResult {
  const nodes = getTopicSubgraph(topicRoot, graph);
  const events: CreationEvent[] = [];
  const files = app.vault.getMarkdownFiles();
  // 2026-08:按 path 索引所有 vault 文件,subgraph 节点按 path 查 → 杜绝 basename 碰撞。
  const fileByPath = new Map<string, (typeof files)[number]>();
  for (const f of files) {
    fileByPath.set(f.path, f);
  }

  // 遍历 subgraph 内的 path,每个文件读其 bklinks 生成事件
  for (const filePath of nodes) {
    const file = fileByPath.get(filePath);
    if (!file) continue;  // orphan 合成 path(如 "X.md" 而无 vault 文件)跳过

    const bklinks = graph.forward.get(filePath) ?? [];
    if (bklinks.length === 0) continue; // 根本身无 bklink 可发事件

    for (let i = 0; i < bklinks.length; i++) {
      const bkPath = bklinks[i];
      // 2026-08:sourcePath 直接用 graph.forward 解析后的 path(无需再查 fileByBasename)。
      events.push({
        id: `vault-${topicRoot}-${file.path}-${i}`,
        target: file.basename,       // 当前笔记(子)display basename
        targetPath: file.path,      // child 完整 vault 路径(身份 key)
        sourcePath: bkPath,         // bklink 前置(父,完整路径)
        position: { ...ZERO_POSITION },
        firstSeenAt: file.stat.ctime,
        runId: VAULT_SCAN_RUN_ID,
        topicRoot,                  // 主题根路径(topicRoot 现在是 path)
      });
    }
  }

  return { topicRoot, events, nodeCount: nodes.size };
}

/**
 * 删除指定 topicRoot 的所有事件。不修改入参数组。
 * 旧数据(undefined topicRoot)保留——向后兼容。
 */
export function removeEventsByTopicRoot(
  events: CreationEvent[],
  topicRoot: string,
): CreationEvent[] {
  return events.filter((e) => e.topicRoot !== topicRoot);
}
