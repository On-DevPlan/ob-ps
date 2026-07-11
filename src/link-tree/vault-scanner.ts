/**
 * vault-scanner.ts — 从 vault 当前状态扫描指定主题的 CreationEvent
 *
 * 与 snapshot-hook 的关系:本模块取代了之前基于 "snapshotEnabled 进程"
 * 的事件捕获。现在事件由用户主动点击触发,数据来自 vault 实时 bklink
 * 拓扑,不再是进程启动时的「未解析链接快照」。
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
 * @param app            Obsidian App
 * @param activeNotePath 当前活动笔记的 vault 相对路径,如 "前端/js的emit底层原理.md"
 */
export async function scanActiveNoteTopic(
  app: App,
  activeNotePath: string,
): Promise<ScanResult> {
  const graph = buildBklinkGraph(app);
  const activeBasename = basenameFromPath(activeNotePath);
  const topicRoot = findTopicRoot(activeBasename, graph);
  return scanTopicEvents(app, topicRoot, graph);
}

/**
 * 扫描指定根主题,生成该主题所有节点的 bklink 边作为 CreationEvent。
 *
 * 事件方向(关键):
 *   target     = 当前笔记名 (子/依赖者)
 *   sourcePath = bklink 前置笔记的 path (父/被依赖者)
 *
 * 这样 projectTree (source=父, target=子) 会把 bklink 前置当作根,
 * 当前笔记当作子节点。知识点(bklink 空)无事件以它为 target,自然成为 ghost 根。
 *
 * 纯函数除 vault 读之外无副作用——测试可注入 mock app。
 *
 * @param app       Obsidian App,用于读 vault 文件元数据
 * @param topicRoot 主题根 basename
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
  const fileByBasename = new Map<string, (typeof files)[number]>();
  for (const f of files) {
    fileByBasename.set(f.basename, f);
  }

  for (const basename of nodes) {
    const file = fileByBasename.get(basename);
    if (!file) continue;

    const bklinks = graph.forward.get(basename) ?? [];
    if (bklinks.length === 0) continue; // 根本身无 bklink 可发事件

    for (let i = 0; i < bklinks.length; i++) {
      const bkBasename = bklinks[i];
      // bklink 前置笔记的 path —— 作为 sourcePath(父)。
      // 前置不存在(orphan)时 fallback 到 "<basename>.md",projectTree 仍能建边。
      const bkFile = fileByBasename.get(bkBasename);
      const bkPath = bkFile?.path ?? `${bkBasename}.md`;
      events.push({
        id: `vault-${topicRoot}-${basename}-${i}`,
        target: basename,           // 当前笔记(子)
        sourcePath: bkPath,         // bklink 前置(父)
        position: { ...ZERO_POSITION },
        firstSeenAt: file.stat.ctime,
        runId: VAULT_SCAN_RUN_ID,
        topicRoot,
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

/** 从 vault 相对路径提取 basename,去除 .md 后缀 */
function basenameFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}
