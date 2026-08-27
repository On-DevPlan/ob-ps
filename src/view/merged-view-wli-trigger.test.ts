/**
 * WLI 触发器回归测试 —— 覆盖双列列表的分离刷新契约。
 *
 * 设计契约(2026-08 修复):
 *   · 未解析双链:由 metadataCache.on("changed") 热更新 —— 在旧笔记里写 [[target]]
 *     保存后,侧边栏应立即出现该未解析。
 *   · 已解析双链:由 vault.on("create") 更新 —— 「新建文件中的已解析双链」严格反映
 *     新文件创建行为,旧文件修改(包括加 [[双链]])不应让列表出现干扰项。
 *   · 两个列表用独立容器(wliUnresolvedWrapEl / wliResolvedWrapEl)分开渲染。
 *
 * 测试方式:读取源码做静态校验。原因:
 *   · MergedRunnerInspectorView 是 ItemView 子类,实例化需要 WorkspaceLeaf +
 *     完整 Obsidian 组件栈 + MergedViewOptions 注入。
 *   · 该契约稳定后,改触发器是 breaking change,静态校验足以做回归。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MERGED_VIEW_PATH = resolve(__dirname, "./merged-view.ts");

/** 去掉行注释,避免注释文本干扰断言 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("MergedRunnerInspectorView WLI 触发器契约", () => {
  const src = readFileSync(MERGED_VIEW_PATH, "utf8");
  const code = stripComments(src);

  it("未解析双链由 metadataCache.on('changed') 热更新", () => {
    expect(code).toMatch(
      /metadataCache\.on\(\s*["']changed["'][\s\S]{0,120}scheduleWliRefresh/,
    );
  });

  it("已解析双链由 vault.on('create') 更新", () => {
    expect(code).toMatch(
      /vault\.on\(\s*["']create["'][\s\S]{0,120}scheduleResolvedRefresh/,
    );
  });

  it("已解析刷新不依赖 metadataCache.on('changed')", () => {
    // 已解析快照刷新走 scheduleResolvedRefresh,不应挂在 changed 事件上
    expect(code).not.toMatch(
      /metadataCache\.on\(\s*["']changed["'][\s\S]{0,120}scheduleResolvedRefresh/,
    );
  });

  it("未解析刷新不依赖 vault.on('create')", () => {
    // 未解析热更新走 scheduleWliRefresh,不应挂在 create 事件上
    expect(code).not.toMatch(
      /vault\.on\(\s*["']create["'][\s\S]{0,120}scheduleWliRefresh/,
    );
  });

  it("「新建文件中的已解析双链」subsection 标题已更新", () => {
    expect(src).toContain('title: "新建文件中的已解析双链"');
    expect(src).not.toContain('title: "最新已解析双链"');
  });

  it("两个列表使用独立容器渲染", () => {
    expect(src).toContain("wliUnresolvedWrapEl");
    expect(src).toContain("wliResolvedWrapEl");
  });
});

/**
 * 行为层契约:旧文件修改不应让旧文件中的双链进入"新建文件中的已解析双链"列表。
 *
 * collectRows + dedupeRowsByTarget 本身不做时间窗口过滤(旧文件双链会被收集)——
 * 真正的过滤由「已解析刷新只挂 vault.on('create')」这一架构决策保证:
 * 旧文件修改不触发 refreshResolved,旧行不会进入已解析快照的渲染。
 */
import { collectRows, type CollectorSource } from "../wikilink-inspector/link-collector";
import { partitionByState, dedupeRowsByTarget } from "../wikilink-inspector/link-row";

describe("旧文件双链不应进入新建文件视角下的列表", () => {
  it("collector 层不隐式过滤,过滤由触发器层保证", () => {
    const src: CollectorSource = {
      listFiles: () => [
        { path: "old.md", mtime: 100 }, // 旧文件
        { path: "new.md", mtime: 200 }, // 新文件(刚 vault.on("create") 触发)
      ],
      getLinks: (p) => {
        if (p === "old.md") return [{ link: "B" }];
        if (p === "new.md") return [{ link: "A" }, { link: "B" }];
        return [];
      },
      unresolvedTargets: () => new Set(),
    };
    const rows = collectRows(src);
    const { resolved } = partitionByState(rows);
    const deduped = dedupeRowsByTarget(resolved);

    // deduped 按首次出现(mtime 降序)保留 → new.md 的 [[B]] 排在前面
    expect(deduped[0]?.sourcePath).toBe("new.md");
    expect(deduped[0]?.target).toBe("A");
    expect(deduped[1]?.sourcePath).toBe("new.md");
    expect(deduped[1]?.target).toBe("B");
  });
});