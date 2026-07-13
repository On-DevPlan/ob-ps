import { describe, it, expect } from "vitest";
import {
  scanTopicEvents,
  removeEventsByTopicRoot,
} from "./vault-scanner";
import type { BklinkGraph } from "./topic-resolver";
import type { CreationEvent } from "./creation-event";
import type { App } from "obsidian";

function makeGraph(entries: Array<[string, string[]]>): BklinkGraph {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const [name, bks] of entries) {
    forward.set(name, [...bks]);
    for (const bk of bks) {
      if (!forward.has(bk)) forward.set(bk, []);
      if (!backward.has(bk)) backward.set(bk, []);
      backward.get(bk)!.push(name);
    }
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
    },
  } as unknown as App;
}

describe("scanTopicEvents", () => {
  it("单节点根本身不产生事件", () => {
    const g = makeGraph([["root", []]]);
    const app = makeApp([{ basename: "root", path: "root.md", stat: { ctime: 1 } }]);
    const r = scanTopicEvents(app, "root", g);
    expect(r.topicRoot).toBe("root");
    expect(r.nodeCount).toBe(1);
    expect(r.events).toEqual([]);
  });

  it("根 + 1 个 dependent：产生 1 条事件 (target=子, sourcePath=前置父)", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    expect(r.events).toHaveLength(1);
    // 对调后:A 是当前笔记(子),root 是 bklink 前置(父/source)
    expect(r.events[0].target).toBe("A");
    expect(r.events[0].sourcePath).toBe("root.md");
    expect(r.events[0].topicRoot).toBe("root");
    expect(r.events[0].runId).toBe("vault-scan");
  });

  it("事件 id 包含 topicRoot、basename、index", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    expect(r.events[0].id).toBe("vault-root-A-0");
  });

  it("position 固定为 {0, 0}", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    expect(r.events[0].position).toEqual({ line: 0, col: 0 });
  });

  it("firstSeenAt 等于文件 ctime", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 12345 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    expect(r.events[0].firstSeenAt).toBe(12345);
  });

  it("vault 中找不到的节点被跳过", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
      ["ghost", ["root"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    // ghost 不在 vault,跳过;只有 A 产生事件
    expect(r.events).toHaveLength(1);
    expect(r.events[0].target).toBe("A");
    expect(r.events[0].sourcePath).toBe("root.md");
  });

  it("多 bklink 笔记生成多条事件 (target 都是当前笔记)", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root", "B"]],
      ["B", []],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
      { basename: "B", path: "B.md", stat: { ctime: 3 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    // A.bklink=[root, B],产生 2 事件,target 都是 A,sourcePath 分别是 root.md / B.md
    expect(r.events).toHaveLength(2);
    const sources = r.events.map((e) => e.sourcePath).sort();
    expect(sources).toEqual(["B.md", "root.md"]);
    expect(r.events.every((e) => e.target === "A")).toBe(true);
  });

  it("orphan bklink 目标(不在 vault)的 sourcePath fallback 为 <basename>.md", () => {
    // B 同时依赖 root(在 vault) 和 missing(orphan),所以 B 在 root 子图里
    const g = makeGraph([
      ["root", []],
      ["B", ["root", "missing"]],
    ]);
    const app = makeApp([
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "B", path: "B.md", stat: { ctime: 2 } },
    ]);
    const r = scanTopicEvents(app, "root", g);
    // B.bklink=[root, missing],产生 2 事件
    expect(r.events).toHaveLength(2);
    const sources = r.events.map((e) => e.sourcePath).sort();
    expect(sources).toEqual(["missing.md", "root.md"]);
  });
});

describe("removeEventsByTopicRoot", () => {
  function ev(topicRoot: string | undefined, target: string): CreationEvent {
    return {
      id: `e-${topicRoot ?? "none"}-${target}`,
      target,
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
