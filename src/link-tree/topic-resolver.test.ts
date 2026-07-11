/**
 * topic-resolver.test.ts — findTopicRoot / getTopicSubgraph 单测
 */
import { describe, it, expect } from "vitest";
import {
  buildBklinkGraph,
  findTopicRoot,
  getTopicSubgraph,
  getAllTopicRoots,
  type BklinkGraph,
} from "./topic-resolver";

/**
 * 构造一个 BklinkGraph 而不依赖 Obsidian App
 * 只显式列出的节点会被注册;bklink 指向未列出的目标时,目标不算图的节点
 */
function makeGraph(entries: Array<[string, string[]]>): BklinkGraph {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  const registered = new Set(entries.map(([n]) => n));

  // 只注册 entries 中的节点
  for (const [name, bks] of entries) {
    forward.set(name, [...bks]);
    for (const bk of bks) {
      if (!backward.has(bk)) backward.set(bk, []);
      backward.get(bk)!.push(name);
      // 不在 registered 中的目标不进 forward（模拟"目标不存在"）
      void registered;
    }
  }

  return { forward, backward };
}

// ============ findTopicRoot ============

describe("findTopicRoot", () => {
  it("空 bklink 的节点自己是根", () => {
    const g = makeGraph([["root", []]]);
    expect(findTopicRoot("root", g)).toBe("root");
  });

  it("单链 1 跳：A → root", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    expect(findTopicRoot("A", g)).toBe("root");
  });

  it("单链 3 跳：D → C → B → A", () => {
    const g = makeGraph([
      ["A", []],
      ["B", ["A"]],
      ["C", ["B"]],
      ["D", ["C"]],
    ]);
    expect(findTopicRoot("D", g)).toBe("A");
  });

  it("多 bklink：找最近的根", () => {
    const g = makeGraph([
      ["rootA", []],
      ["rootB", []],
      ["X", ["rootA", "rootB"]],  // X 同时依赖两个根
    ]);
    // 两个根都是 1 跳,取第一个
    expect(findTopicRoot("X", g)).toBe("rootA");
  });

  it("多 bklink：选最近根(同 depth 时取先入队)", () => {
    // root 经 B 是 2 跳,C 是 1 跳;按 depth 最小,C 胜
    const g = makeGraph([
      ["root", []],
      ["B", ["root"]],
      ["C", []],
      ["A", ["B", "C"]],
    ]);
    // A 直接依赖 B(depth→root 深度 2)和 C(depth 1),取更浅的 C
    expect(findTopicRoot("A", g)).toBe("C");
  });

  it("多 bklink：两个根都有内容时,选深度更小的", () => {
    const g = makeGraph([
      ["rootA", []],
      ["rootB", []],
      ["X", ["rootA"]],    // 间接让 rootA 有 backward
      ["Y", ["rootB"]],    // 间接让 rootB 有 backward
      ["A", ["rootA", "rootB"]],
    ]);
    // A 直接依赖两个根(深度都是 1),两个都有 backward
    // → 选先入队的 rootA
    expect(findTopicRoot("A", g)).toBe("rootA");
  });

  it("孤儿节点(bklink 目标不在图里) — fallback 到自身", () => {
    const g = makeGraph([["A", ["ghost"]]]);
    // ghost 不在 forward,findTopicRootSingleChain 会发现 next[0] 不在图里,返回 A
    expect(findTopicRoot("A", g)).toBe("A");
  });

  it("图里完全不存在的节点 — fallback 到自身", () => {
    const g = makeGraph([["A", []]]);
    expect(findTopicRoot("unknown", g)).toBe("unknown");
  });

  it("环：A → B → A(都不空 bklink) — 兜底返回 current", () => {
    const g = makeGraph([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    // A→B→A,visited={A,B} 后再次访问 A,跳出循环返回 current=B
    // 测试目的:不抛错,有返回值
    const result = findTopicRoot("A", g);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============ getTopicSubgraph ============

describe("getTopicSubgraph", () => {
  it("单根单层:只有根本身", () => {
    const g = makeGraph([["root", []]]);
    expect(getTopicSubgraph("root", g)).toEqual(new Set(["root"]));
  });

  it("根 + 1 个直接 dependent", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
    ]);
    expect(getTopicSubgraph("root", g)).toEqual(new Set(["root", "A"]));
  });

  it("根 + 多层链:backward BFS 拉所有可达", () => {
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
      ["B", ["A"]],
      ["C", ["B"]],
    ]);
    expect(getTopicSubgraph("root", g)).toEqual(
      new Set(["root", "A", "B", "C"]),
    );
  });

  it("两个独立根:子图不重叠", () => {
    const g = makeGraph([
      ["root1", []],
      ["root2", []],
      ["A", ["root1"]],
      ["B", ["root2"]],
    ]);
    expect(getTopicSubgraph("root1", g)).toEqual(new Set(["root1", "A"]));
    expect(getTopicSubgraph("root2", g)).toEqual(new Set(["root2", "B"]));
  });

  it("关键场景:多根共享 backward 节点", () => {
    // root1 和 root2 都被 X 依赖,X 应该只在 X 自己 backward BFS 到的子图里
    // 但 root1 和 root2 各自的子图不重叠
    const g = makeGraph([
      ["root1", []],
      ["root2", []],
      ["X", ["root1", "root2"]],
    ]);
    expect(getTopicSubgraph("root1", g)).toEqual(new Set(["root1", "X"]));
    expect(getTopicSubgraph("root2", g)).toEqual(new Set(["root2", "X"]));
    // 注:X 在两个主题都出现,因为它确实"通过 bklink 链追到两个根"
  });

  it("backward 链有交叉节点", () => {
    // root ← A ← B
    //          ↑
    //          C
    // C 也依赖 A,但 B 和 C 是兄弟
    const g = makeGraph([
      ["root", []],
      ["A", ["root"]],
      ["B", ["A"]],
      ["C", ["A"]],
    ]);
    expect(getTopicSubgraph("root", g)).toEqual(
      new Set(["root", "A", "B", "C"]),
    );
  });

  it("空图", () => {
    const g = makeGraph([]);
    expect(getTopicSubgraph("root", g)).toEqual(new Set(["root"]));
  });
});

// ============ getAllTopicRoots ============

describe("getAllTopicRoots", () => {
  it("多个根", () => {
    const g = makeGraph([
      ["root1", []],
      ["root2", []],
      ["A", ["root1"]],
    ]);
    expect(getAllTopicRoots(g).sort()).toEqual(["root1", "root2"]);
  });

  it("无根", () => {
    const g = makeGraph([["A", ["B"]], ["B", ["A"]]]);
    expect(getAllTopicRoots(g)).toEqual([]);
  });
});

// ============ buildBklinkGraph 集成 ============

describe("buildBklinkGraph", () => {
  it("从 fake app 构建图", () => {
    const files = [
      { basename: "root", path: "root.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
      { basename: "B", path: "B.md", stat: { ctime: 3 } },
    ];

    const cache = new Map<string, { frontmatter?: { bklink?: unknown } }>();
    cache.set("root.md", { frontmatter: {} });
    cache.set("A.md", { frontmatter: { bklink: '[[root]]' } });
    cache.set("B.md", { frontmatter: { bklink: '[[A]]' } });

    const fakeApp = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => {
          return files.find((f) => f.path === path) ?? null;
        },
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => cache.get(file.path) ?? null,
      },
    };

    const g = buildBklinkGraph(fakeApp as unknown as Parameters<typeof buildBklinkGraph>[0]);

    expect(g.forward.get("root")).toEqual([]);
    expect(g.forward.get("A")).toEqual(["root"]);
    expect(g.forward.get("B")).toEqual(["A"]);
    expect(g.backward.get("root")).toEqual(["A"]);
    expect(g.backward.get("A")).toEqual(["B"]);
    expect(g.backward.get("B")).toBeUndefined();
  });

  it("支持数组形式 bklink", () => {
    const files = [
      { basename: "X", path: "X.md", stat: { ctime: 1 } },
      { basename: "A", path: "A.md", stat: { ctime: 2 } },
      { basename: "B", path: "B.md", stat: { ctime: 3 } },
    ];

    const cache = new Map<string, { frontmatter?: { bklink?: unknown } }>();
    cache.set("X.md", { frontmatter: {} });
    cache.set("A.md", { frontmatter: { bklink: '[[X]]' } });
    cache.set("B.md", { frontmatter: { bklink: ["[[X]]", "[[A]]"] } });

    const fakeApp = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find((f) => f.path === path) ?? null,
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => cache.get(file.path) ?? null,
      },
    };

    const g = buildBklinkGraph(fakeApp as unknown as Parameters<typeof buildBklinkGraph>[0]);

    expect(g.forward.get("B")).toEqual(["X", "A"]);
    expect(g.backward.get("X")?.sort()).toEqual(["A", "B"]);
    expect(g.backward.get("A")).toEqual(["B"]);
  });

  it("无 metadataCache 的 app 返回空图", () => {
    const files = [
      { basename: "A", path: "A.md", stat: { ctime: 1 } },
    ];
    const fakeApp = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: () => null,
      },
      // 没有 metadataCache
    };

    const g = buildBklinkGraph(fakeApp as unknown as Parameters<typeof buildBklinkGraph>[0]);

    expect(g.forward.get("A")).toEqual([]);
  });
});

// ============ 集成:模拟 123 vault 的关键场景 ============

describe("集成场景:模拟 123 vault", () => {
  it("场景 1:连续型R、V相关计算 → 常见题型(3 跳链)", () => {
    const g = makeGraph([
      ["常见题型", []],
      ["知识点", []],
      ["连续型R、V相关计算", ["常见题型"]],
      ["R、V是什么，区间概率是什么", ["连续型R、V相关计算"]],
      ["分布函数、概率密度是什么", ["连续型R、V相关计算"]],
      ["常见分布期望 (E(X)有哪些公式)", ["连续型R、V相关计算"]],
    ]);

    expect(findTopicRoot("连续型R、V相关计算", g)).toBe("常见题型");
    expect(findTopicRoot("R、V是什么，区间概率是什么", g)).toBe("常见题型");

    const sub = getTopicSubgraph("常见题型", g);
    expect(sub).toEqual(new Set([
      "常见题型",
      "连续型R、V相关计算",
      "R、V是什么，区间概率是什么",
      "分布函数、概率密度是什么",
      "常见分布期望 (E(X)有哪些公式)",
    ]));
  });

  it("场景 2:CSS、TTL门电路原理 → 数字逻辑(1 跳)", () => {
    const g = makeGraph([
      ["数字逻辑", []],
      ["CMOS、TTL门电路原理", ["数字逻辑"]],
      ["CMOS电路扇出系数的计算相关题型", ["CMOS、TTL门电路原理"]],
    ]);

    expect(findTopicRoot("CMOS、TTL门电路原理", g)).toBe("数字逻辑");
    const sub = getTopicSubgraph("数字逻辑", g);
    expect(sub).toEqual(new Set([
      "数字逻辑",
      "CMOS、TTL门电路原理",
      "CMOS电路扇出系数的计算相关题型",
    ]));
  });

  it("场景 3:IMAP 模型 → 计网复习(3 跳)", () => {
    const g = makeGraph([
      ["计网复习", []],
      ["计网应用层", ["计网复习"]],
      ["IMAP", ["计网应用层"]],
      ["怎么解决 IMAP 模型，服务器的负担会大幅上升", ["IMAP"]],
    ]);

    expect(findTopicRoot("怎么解决 IMAP 模型，服务器的负担会大幅上升", g)).toBe("计网复习");
    expect(getTopicSubgraph("计网复习", g).size).toBe(4);
  });

  it("场景 4:js的emit底层原理 → 前端(1 跳)", () => {
    const g = makeGraph([
      ["前端", []],
      ["js的emit底层原理", ["前端"]],
    ]);
    expect(findTopicRoot("js的emit底层原理", g)).toBe("前端");
  });
});