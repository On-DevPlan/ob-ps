/**
 * tree-projector.test.ts — projectTree 纯函数测试
 */

import { describe, it, expect } from "vitest";
import { projectTree, type ProjectDeps } from "./tree-projector";
import type { CreationEvent } from "./creation-event";

/** 辅助：快速造事件 */
function ev(id: string, target: string, sourcePath: string, firstSeenAt = 0): CreationEvent {
  return { id, target, sourcePath, position: { line: 1, col: 0 }, firstSeenAt, runId: "R1" };
}

/** 假 ProjectDeps：默认全 resolved、全 exists */
const deps = (options?: {
  unresolved?: Set<string>;
  deleted?: Set<string>;
}): ProjectDeps => {
  const unresolved = options?.unresolved ?? new Set();
  const deleted = options?.deleted ?? new Set();
  return {
    isResolved(t, src) { return !unresolved.has(t); },
    sourceExists(p) { return !deleted.has(p); },
  };
};

describe("projectTree", () => {
  it("单根", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);
    expect(roots[0].event.target).toBe("B");
    expect(roots[0].children).toHaveLength(0);
    expect(roots[0].depth).toBe(0);
  });

  it("单链 A→B→C", () => {
    const events = [
      ev("e1", "B", "A.md"),
      ev("e2", "C", "B.md"),    // source basename = B → child of e1
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);          // 只有一个根 B
    expect(roots[0].event.id).toBe("e1");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].event.id).toBe("e2");
    expect(roots[0].children[0].depth).toBe(1);
  });

  it("多根森林", () => {
    const events = [
      ev("e1", "B", "A.md"),
      ev("e2", "D", "C.md"),    // C 不在事件里 → 独立根
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(2);
    expect(roots[0].event.target).toBe("B");
    expect(roots[1].event.target).toBe("D");
  });

  it("挂载与 firstSeenAt 顺序解耦:子 ctime 早于父 ctime 也应正确挂载", () => {
    // 重构后挂载不再依赖 firstSeenAt,只看 byTarget(parentKey) 是否有父。
    // 两种顺序都应得到「B 为根,C 挂 B 下」的结果。
    const childFirst = [
      ev("e2", "C", "B.md", 50),
      ev("e1", "B", "A.md", 100),
    ];
    const r1 = projectTree(childFirst, deps());
    expect(r1).toHaveLength(1);
    expect(r1[0].event.target).toBe("B");
    expect(r1[0].children).toHaveLength(1);
    expect(r1[0].children[0].event.target).toBe("C");

    const parentFirst = [
      ev("e1", "B", "A.md", 50),
      ev("e2", "C", "B.md", 100),
    ];
    const r2 = projectTree(parentFirst, deps());
    expect(r2).toHaveLength(1);
    expect(r2[0].event.target).toBe("B");
    expect(r2[0].children[0].event.target).toBe("C");
  });

  it("回归:子 ctime 早于父 ctime 的多级链不拆根(2026-07 双 ghost bug)", () => {
    // 复刻真实场景:CLS 笔记先建(50),其父 性能优化 后建(100)。
    // 旧算法:CLS 先处理时父未入 nodeMap → 误判 root → 多出 ghost
    // 新算法:挂载与顺序解耦,CLS 正确挂到 性能优化 下
    const events = [
      ev("e_cls", "用CLS判断", "性能优化.md", 50),
      ev("e_perf", "性能优化", "工程化.md", 100),
      ev("e_eng", "工程化", "前端.md", 200),
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);
    expect(roots[0].event.target).toBe("工程化");
    expect(roots[0].children[0].event.target).toBe("性能优化");
    expect(roots[0].children[0].children[0].event.target).toBe("用CLS判断");
  });

  it("status 派生：target 已解析 → created", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ unresolved: new Set() }));
    expect(roots[0].status).toBe("created");
  });

  it("status 派生：target 未解析 → pending", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ unresolved: new Set(["B"]) }));
    expect(roots[0].status).toBe("pending");
  });

  it("isStale 派生：源笔记被删 → true", () => {
    const events = [ev("e1", "B", "A.md")];
    const roots = projectTree(events, deps({ deleted: new Set(["A.md"]) }));
    expect(roots[0].isStale).toBe(true);
  });

  it("同 target 多事件：parent 匹配用最新的事件", () => {
    const events = [
      ev("e_new", "B", "C.md", 10),
      ev("e_child", "D", "B.md", 50),
      ev("e_old", "B", "A.md", 99),
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(2); // B(C.md) 根, B(A.md) 根
    const parent = roots.find(r => r.event.id === "e_new")!;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].event.id).toBe("e_child");
    const old = roots.find(r => r.event.id === "e_old")!;
    expect(old.children).toHaveLength(0);
  });

  it("自身引用：target == basename(sourcePath) → 跳过", () => {
    const events = [
      ev("e1", "A", "A.md"), // source basename = "A" = target → 自身引用
    ];
    const roots = projectTree(events, deps());
    expect(roots).toHaveLength(1);  // 不会自我挂载
    expect(roots[0].children).toHaveLength(0);
  });

  it("空输入 → 空输出", () => {
    expect(projectTree([], deps())).toEqual([]);
  });
});
