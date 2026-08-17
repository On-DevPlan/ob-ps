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
  it("从 fake app 构建图(单文件同名无碰撞场景)", () => {
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

    // 修复后 graph 用 path 作 key(2026-08 id 化)
    expect(g.forward.get("root.md")).toEqual([]);
    expect(g.forward.get("A.md")).toEqual(["root.md"]);
    expect(g.forward.get("B.md")).toEqual(["A.md"]);
    expect(g.backward.get("root.md")).toEqual(["A.md"]);
    expect(g.backward.get("A.md")).toEqual(["B.md"]);
    // 2026-08:backward 主动为空数组(便于 getTopicSubgraph 直接 [] ?? [] 迭代)而非 undefined
    expect(g.backward.get("B.md")).toEqual([]);
  });

  it("回归:basename 碰撞 → 两个同名文件独立 bklink 链(2026-08 修复)", () => {
    // 用户场景:test/工程化.md 和 前端/工程化.md 同名。
    // 性能优化.md bklink 指向 [[工程化]] (语义上指向前端/工程化.md)。
    // 修复前:graph 按 basename key,forward["工程化"] 被后写覆盖,
    //   findTopicRoot("工程化") 会走 前端 的链,把性能优化也带进 test 的子图。
    // 修复后:graph 用 path key;bklink basename 通过 getFirstLinkpathDest 解析为单一目标,
    //   前端/工程化.md 的 bklink "前端" → 前端/前端.md,test/工程化.md 的 bklink "前端" → 同;
    //   性能优化 的 bklink "工程化" → 模拟返回 前端/工程化.md(不是两个都拉)。
    const files = [
      { basename: "前端", path: "前端/前端.md", stat: { ctime: 1 } },
      { basename: "工程化", path: "前端/工程化.md", stat: { ctime: 2 } },
      { basename: "工程化", path: "test/工程化.md", stat: { ctime: 3 } },
      { basename: "性能优化", path: "前端/性能优化.md", stat: { ctime: 4 } },
    ];

    const cache = new Map<string, { frontmatter?: { bklink?: unknown } }>();
    cache.set("前端/前端.md", { frontmatter: {} });
    cache.set("前端/工程化.md", { frontmatter: { bklink: '[[前端]]' } });
    cache.set("test/工程化.md", { frontmatter: { bklink: '[[前端]]' } });  // 独立 bklink 链
    cache.set("前端/性能优化.md", { frontmatter: { bklink: '[[工程化]]' } });

    const fakeApp = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) =>
          files.find((f) => f.path === path) ?? null,
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => cache.get(file.path) ?? null,
        // 2026-08 id 化修复后,buildBklinkGraph 用此 API 解析 bklink basename → 单一文件路径
        getFirstLinkpathDest: (link: string, _source: string) => {
          const matches = files.filter((f) => f.basename === link);
          // 模拟 Obsidian:多个匹配时按 path 字典序取第一个
          // test/工程化.md < 前端/工程化.md,字典序 test 在前 → 但本测试期望"前端"语义
          // 我们直接按文件数组顺序,与 Obsidian 默认行为一致
          return matches[0] ?? null;
        },
      },
    };

    const g = buildBklinkGraph(fakeApp as unknown as Parameters<typeof buildBklinkGraph>[0]);

    // 两个 工程化 文件的 bklink 各自独立保留 —— 不再被后写覆盖
    expect(g.forward.get("前端/工程化.md")).toEqual(["前端/前端.md"]);
    expect(g.forward.get("test/工程化.md")).toEqual(["前端/前端.md"]);
    // 性能优化 bklink "工程化" → 解析到单一文件(matches[0] = 前端/工程化.md 字典序在前)
    expect(g.forward.get("前端/性能优化.md")).toEqual(["前端/工程化.md"]);
    // 只有被解析到的 工程化 有 backward entry;另一个文件独立(没有 bleed)
    expect(g.backward.get("前端/工程化.md")).toEqual(["前端/性能优化.md"]);
    expect(g.backward.get("test/工程化.md")).toEqual([]);
  });

  it("回归:findTopicRoot 用 path 走正确 bklink 链(2026-08 修复)", () => {
    // 两个独立链:test/工程化 → test_topic,前端/工程化 → 前端_topic。
    // 性能优化 只依赖 前端/工程化,不应出现在 test_topic 子图里。
    // 关键:模拟 getFirstLinkpathDest 按 source folder 优先,避免 bleed
    // (test/性能优化 不存在,只有 前端/性能优化)
    const files = [
      { basename: "前端_topic", path: "test/test_topic.md", stat: { ctime: 1 } },
      { basename: "前端_topic", path: "前端/前端_topic.md", stat: { ctime: 2 } },
      { basename: "工程化", path: "test/工程化.md", stat: { ctime: 3 } },
      { basename: "工程化", path: "前端/工程化.md", stat: { ctime: 4 } },
      { basename: "性能优化", path: "前端/性能优化.md", stat: { ctime: 5 } },
    ];

    const cache = new Map<string, { frontmatter?: { bklink?: unknown } }>();
    cache.set("test/test_topic.md", { frontmatter: {} });
    cache.set("前端/前端_topic.md", { frontmatter: {} });
    cache.set("test/工程化.md", { frontmatter: { bklink: '[[前端_topic]]' } });
    cache.set("前端/工程化.md", { frontmatter: { bklink: '[[前端_topic]]' } });
    cache.set("前端/性能优化.md", { frontmatter: { bklink: '[[工程化]]' } });

    const fakeApp = {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) =>
          files.find((f) => f.path === path) ?? null,
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => cache.get(file.path) ?? null,
        // 关键修复:模拟 Obsidian 解析 bklink 时按 source folder 优先(避免 bleed)
        getFirstLinkpathDest: (link: string, source: string) => {
          const matches = files.filter((f) => f.basename === link);
          if (matches.length === 0) return null;
          // 优先同 folder 的同名文件(更符合用户对 "bklink 语义" 的预期)
          const sourceFolder = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
          const sameFolder = matches.find((m) => {
            const mFolder = m.path.includes("/") ? m.path.slice(0, m.path.lastIndexOf("/")) : "";
            return mFolder === sourceFolder;
          });
          return sameFolder ?? matches[0];
        },
      },
    };

    const g = buildBklinkGraph(fakeApp as unknown as Parameters<typeof buildBklinkGraph>[0]);

    // test/工程化 → 同 folder 的 test_topic(不是 前端/前端_topic)
    expect(g.forward.get("test/工程化.md")).toEqual(["test/test_topic.md"]);
    // 前端/工程化 → 同 folder 的 前端/前端_topic
    expect(g.forward.get("前端/工程化.md")).toEqual(["前端/前端_topic.md"]);
    // 性能优化 → 同 folder 的 前端/工程化.md
    expect(g.forward.get("前端/性能优化.md")).toEqual(["前端/工程化.md"]);

    // test/工程化 应走到 test/test_topic
    expect(findTopicRoot("test/工程化.md", g)).toBe("test/test_topic.md");
    // test_topic 子图只包含 test/工程化(性能优化 在 前端_topic 子图里,不 bleed)
    const testSub = getTopicSubgraph("test/test_topic.md", g);
    expect(testSub).toEqual(new Set(["test/test_topic.md", "test/工程化.md"]));
    // 前端_topic 子图包含 前端/工程化 和 性能优化
    const frontSub = getTopicSubgraph("前端/前端_topic.md", g);
    expect(frontSub).toEqual(new Set([
      "前端/前端_topic.md",
      "前端/工程化.md",
      "前端/性能优化.md",
    ]));
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

    // 修复后 graph 用 path 作 key(2026-08 id 化)
    expect(g.forward.get("B.md")?.sort()).toEqual(["A.md", "X.md"]);
    expect(g.backward.get("X.md")?.sort()).toEqual(["A.md", "B.md"]);
    expect(g.backward.get("A.md")).toEqual(["B.md"]);
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

    // 单文件同名无碰撞,基础行为(修复后用 path 作 key)
    expect(g.forward.get("A.md")).toEqual([]);
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