import { describe, it, expect } from "vitest";
import {
  scanTopicEvents,
  removeEventsByTopicRoot,
} from "./vault-scanner";
import type { BklinkGraph } from "./topic-resolver";
import type { CreationEvent } from "./creation-event";
import type { App } from "obsidian";

/**
 * 构造 path-keyed BklinkGraph(2026-08 id 化修复后)
 * entries: [childPath, [parentPath, ...]] —— childPath 文件 bklink 这些 parentPath
 * 默认将每个 childPath 注册为 vault 中的文件(由调用方提供 files)
 */
function makeGraph(entries: Array<[string, string[]]>): BklinkGraph {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();

  for (const [name, bks] of entries) {
    forward.set(name, [...bks]);
    for (const bk of bks) {
      if (!backward.has(bk)) backward.set(bk, []);
      if (!backward.get(bk)!.includes(name)) {
        backward.get(bk)!.push(name);
      }
    }
  }
  // 保证所有 forward key 都有 backward entry
  for (const path of forward.keys()) {
    if (!backward.has(path)) backward.set(path, []);
  }

  return { forward, backward };
}

interface MockFile {
  basename: string;
  path: string;
  stat: { ctime: number };
}

function makeApp(files: MockFile[]): App {
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (p: string) =>
        files.find((f) => f.path === p) ?? null,
    },
    metadataCache: {
      getFileCache: (_file: unknown) => ({ frontmatter: null }),
      // 2026-08 修复:buildBklinkGraph 用此 API 解析 bklink basename → 单一文件路径
      getFirstLinkpathDest: (link: string, _source: string) => {
        const matches = files.filter((f) => f.basename === link);
        return matches[0] ?? null;
      },
    },
  } as unknown as App;
}

describe("scanTopicEvents", () => {
  it("单节点根本身不产生事件", () => {
    const g = makeGraph([["root.md", []]]);
    const app = makeApp([{ basename: "root", path: "root.md", stat: { ctime: 1 } }]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.topicRoot).toBe("root.md");
    expect(r.nodeCount).toBe(1);
    expect(r.events).toEqual([]);
  });

  it("根 + 1 个 dependent：产生 1 条事件 (target=子, sourcePath=前置父)", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.events).toHaveLength(1);
    // 对调后:A 是当前笔记(子),root 是 bklink 前置(父/source)
    expect(r.events[0].target).toBe("A");
    expect(r.events[0].sourcePath).toBe("root.md");
    expect(r.events[0].topicRoot).toBe("root.md");
    expect(r.events[0].runId).toBe("vault-scan");
  });

  it("事件 id 包含 topicRoot、child path、index(2026-08 修复后)", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    // 修复后:id 用 child 完整路径(防 S9 basename 撞 id),不再用 basename
    expect(r.events[0].id).toBe("vault-root.md-A.md-0");
  });

  it("position 固定为 {0, 0}", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.events[0].position).toEqual({ line: 0, col: 0 });
  });

  it("firstSeenAt 等于文件 ctime", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 12345 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.events[0].firstSeenAt).toBe(12345);
  });

  it("vault 中找不到的节点被跳过", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
      ["ghost.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    // ghost 不在 vault,跳过;只有 A 产生事件
    expect(r.events).toHaveLength(1);
    expect(r.events[0].target).toBe("A");
    expect(r.events[0].sourcePath).toBe("root.md");
  });

  it("多 bklink 笔记生成多条事件 (target 都是当前笔记)", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md", "B.md"]],
      ["B.md", []],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
      { basename: "B", path: "B.md", stat: { ctime: 3 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    // A.bklink=[root, B],产生 2 事件,target 都是 A,sourcePath 分别是 root.md / B.md
    expect(r.events).toHaveLength(2);
    const sources = r.events.map((e) => e.sourcePath).sort();
    expect(sources).toEqual(["B.md", "root.md"]);
    expect(r.events.every((e) => e.target === "A")).toBe(true);
  });

  it("orphan bklink 目标(不在 vault)的 sourcePath fallback 为 <basename>.md", () => {
    // B 同时依赖 root(在 vault) 和 missing(orphan),所以 B 在 root 子图里
    const g = makeGraph([
      ["root.md", []],
      ["B.md", ["root.md", "missing.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "B", path: "B.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    // B.bklink=[root, missing],产生 2 事件
    expect(r.events).toHaveLength(2);
    const sources = r.events.map((e) => e.sourcePath).sort();
    expect(sources).toEqual(["missing.md", "root.md"]);
  });

  it("回归:basename 碰撞时 targetPath 写入实际 child 路径(2026-08 id 化)", () => {
    // test/工程化.md 和 前端/工程化.md 共存。修复后,topic-resolver graph 用 path
    // 做 key,getFirstLinkpathDest 把每个 工程化 的 bklink 解析到对应具体文件。
    // graph forward["test/工程化.md"] 和 forward["前端/工程化.md"] 各自独立,
    // backward 不交叉,subgraph 也各自独立。
    // 此测试只验证 vault-scanner 写入 targetPath 字段(用 file.path,不是 undefined)。
    const g = makeGraph([
      ["root.md", []],
      ["test/工程化.md", ["root.md"]],
      ["前端/工程化.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "工程化", path: "test/工程化.md", stat: { ctime: 100 } },
      { basename: "工程化", path: "前端/工程化.md", stat: { ctime: 200 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.events).toHaveLength(2);
    // 两条事件的 target 同名(预期)
    expect(r.events.every((e) => e.target === "工程化")).toBe(true);
    // 但 targetPath 必须不同(修复关键)
    const targetPaths = r.events.map((e) => e.targetPath).sort();
    expect(targetPaths).toEqual(["test/工程化.md", "前端/工程化.md"]);
  });

  it("单 dependent 事件携带 targetPath = child file 完整路径", () => {
    const g = makeGraph([
      ["root.md", []],
      ["A.md", ["root.md"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root.md", g);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].targetPath).toBe("A.md");
  });
});

describe("removeEventsByTopicRoot", () => {
  function ev(topicRoot: string | undefined, target: string): CreationEvent {
    return {
      id: `e-${topicRoot ?? "none"}-${target}`,
      target,
      targetPath: `${target}.md`,
      sourcePath: "x.md",
      position: { line: 0, col: 0 },
      firstSeenAt: 1,
      runId: "vault-scan",
      topicRoot,
    };
  }

  it("删除指定 topicRoot 的事件，保留其他", () => {
    const events = [
      ev("root1", "A"),
      ev("root2", "B"),
      ev("root1", "C"),
    ];
    const out = removeEventsByTopicRoot(events, "root1");
    expect(out).toHaveLength(1);
    expect(out[0].topicRoot).toBe("root2");
  });

  it("无匹配 topicRoot 时返回原数组（不修改入参）", () => {
    const events = [ev("root1", "A"), ev("root2", "B")];
    const out = removeEventsByTopicRoot(events, "root3");
    expect(out).toEqual(events);
  });

  it("topicRoot 为 undefined 的旧事件被保留（向后兼容）", () => {
    const events = [ev(undefined, "A"), ev("root1", "B")];
    const out = removeEventsByTopicRoot(events, "root1");
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("A");
  });

  it("空数组返回空数组", () => {
    expect(removeEventsByTopicRoot([], "root1")).toEqual([]);
  });
});
