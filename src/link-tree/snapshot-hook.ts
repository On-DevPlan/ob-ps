/**
 * snapshot-hook.ts — 双链快照 hook(极薄封装)
 *
 * trackSnapshot(host, runId) —— 包装 capture + appendEvents,
 * 让调用方不需要重复构造 rows / dedup / 时间戳。
 *
 * 调用方负责:何时拍快照、runId 叫什么、拍完后要不要刷 UI、要不要写盘。
 * trackSnapshot 不直接写盘,只返回新事件(调用方再 append + saveSettings)。
 */

import type { App } from "obsidian";
import { capture, buildDedupSet } from "./creation-tracker";
import { loadEvents } from "./link-tree-repository";
import { collectRows } from "../wikilink-inspector/link-collector";
import { makeSource } from "../wikilink-inspector/link-source";
import type { CreationEvent } from "./creation-event";

/** 拍快照所需的最小能力(loadData 来自 Plugin) */
export interface SnapshotHost {
  app: App;
  loadData(): Promise<unknown>;
}

/**
 * 拍一次双链快照。
 *
 * @param host  拥有 App + loadData() 的宿主(通常直接传 Plugin 实例)
 * @param runId 本次快照的批次标识(写进 CreationEvent.runId)
 * @returns     本次新追加的事件(0 = 全部已存在或没有未解析双链)
 */
export async function trackSnapshot(
  host: SnapshotHost,
  runId: string,
): Promise<CreationEvent[]> {
  const source = makeSource(host.app);
  const rows = collectRows(source);

  // 读已有事件(去重用)
  const data = (await host.loadData()) as Parameters<typeof loadEvents>[0];
  const existing = loadEvents(data);

  return capture(rows, buildDedupSet(existing), runId, Date.now());
}
