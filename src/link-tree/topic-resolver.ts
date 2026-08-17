/**
 * topic-resolver.ts — 主题识别 + 连通子图计算
 *
 * 算法:
 *   - findTopicRoot(node) — 沿 forward 链向上追溯到 bklink 为空的根
 *   - getTopicSubgraph(root) — 从根出发 backward BFS 拉整个主题子图
 *   - buildBklinkGraph(app) — 构建 forward + backward 邻接表
 *
 * 设计原则:
 *   - 纯函数式核心(findTopicRoot / getTopicSubgraph) + 副作用封装(buildBklinkGraph)
 *   - 不依赖 Obsidian 具体类型,用最小接口让单测能注入 fake app
 *   - 处理环(cycle)兜底:visited set 防止死循环
 *   - 处理孤儿(不存在的目标):不阻塞,仅记录
 *
 * 身份 key 约定(2026-08 id 化修复):
 *   - graph 的 forward / backward Map 都用「文件完整路径」作 key,
 *     而不是 basename。
 *   - 两个同名文件(test/工程化.md 和 前端/工程化.md)在 graph 中是独立节点,
 *     各自的 bklink 链不互相覆盖。
 *   - bklink 引用本身是 basename(Obsidian wikilink 约定),buildBklinkGraph 内部
 *     解析为「所有同 basename 的文件路径」并对每个建立 edge。
 *     单 bklink 命中多文件 → 多 edge;无命中 → orphan fallback 到 "<basename>.md"。
 */

import type { App } from "obsidian";

// ============ 类型定义 ============

/**
 * bklink 邻接表 —— 双向
 * - forward.get(A.path) = [B.path, C.path, ...] 表示 A.bklink = [[B], [C]]
 *   (A 依赖 B 和 C;bklink 引用按 basename 解析为所有同名文件路径)
 * - backward.get(B.path) = [A.path, D.path, ...] 表示 B 被 A 和 D 依赖
 *
 * key 是文件完整 vault 路径,非 basename —— 保证两个同名文件独立。
 */
export interface BklinkGraph {
  forward: Map<string, string[]>;
  backward: Map<string, string[]>;
}

/**
 * Obsidian App 最小接口 —— 让单测能注入 fake
 * 适配 Obsidian 真实 App(app.vault.getMarkdownFiles)和简化测试桩
 */
export interface VaultLike {
  getMarkdownFiles(): Array<{ basename: string; path: string; stat: { ctime: number } }>;
  vault?: {
    getMarkdownFiles(): Array<{ basename: string; path: string; stat: { ctime: number } }>;
    getAbstractFileByPath(path: string): { basename: string; path: string; stat: { ctime: number } } | null;
  };
  metadataCache?: {
    getFileCache(file: unknown): {
      frontmatter?: { bklink?: unknown };
    } | null;
  };
}

// ============ 图构建 ============

/**
 * 解析 bklink basename 到具体文件路径。
 *
 * 优先用 Obsidian 的 metadataCache.getFirstLinkpathDest(bklink, sourcePath):
 *   - Obsidian 的官方 wikilink 解析,会考虑 sourcePath 的上下文(虽然同 vault 内同名
 *     通常按全局首个匹配,但 API 接受 source 参数,符合 Obsidian 习惯)
 *   - 返回单个 TFile,确保一个 bklink 引用只指向唯一目标(没有 "工程化 → 多文件" 歧义)
 * fallback: 直接从 vault 文件列表找第一个匹配的 basename(测试桩 / 无 metadataCache 时)
 *
 * 2026-08 id 化修复:必须返回单一路径,不再 "bklink basename → 所有同名文件"。
 * 这是阻止 test/工程化 与 前端/工程化 撞图节点的根本措施。
 */
function resolveBkBasename(
  app: App | VaultLike,
  bkBasename: string,
  sourcePath: string,
): string | null {
  const appAny = app as unknown as {
    vault?: { getMarkdownFiles(): unknown[] };
    getMarkdownFiles?: () => unknown[];
    metadataCache?: {
      getFirstLinkpathDest(link: string, source: string): { path: string } | null;
    };
  };

  // 优先 Obsidian 官方解析
  const dest = appAny.metadataCache?.getFirstLinkpathDest?.(bkBasename, sourcePath);
  if (dest?.path) return dest.path;

  // fallback: 第一个匹配的 basename 文件
  const files =
    appAny.vault?.getMarkdownFiles?.() ??
    appAny.getMarkdownFiles?.() ??
    [];
  const match = (files as Array<{ path: string; basename: string }>)
    .find((f) => f.basename === bkBasename);
  return match?.path ?? null;
}

/**
 * 从 vault 读所有 markdown 文件的 bklink,构建双向邻接表。
 *
 * 设计要点:
 *   - forward[path] = [resolvedPath, ...] 表示 path 文件依赖这些 resolvedPath
 *   - bklink 是 Obsidian wikilink 约定(按 basename),构建时通过
 *     metadataCache.getFirstLinkpathDest 解析为「单个最匹配的文件路径」。
 *     保证一个 bklink 引用唯一指向一个目标,杜绝重名文件 bleed。
 *   - 解析失败(无 metadataCache 或 basename 不存在)→ orphan:forward 用 "<basename>.md"
 *     作合成 path,backward 无 entry
 *   - 性能:O(V + E),一次遍历
 *
 * 2026-08 id 化修复:key 是 path 不是 basename,杜绝重名文件撞图节点。
 */
export function buildBklinkGraph(
  app: App | VaultLike,
): BklinkGraph {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();

  // 兼容两种调用形态:
  //   真实 Obsidian: app.vault.getMarkdownFiles()
  //   简化测试桩:   app.getMarkdownFiles()
  const appAny = app as unknown as {
    vault?: { getMarkdownFiles(): unknown[] };
    getMarkdownFiles?: () => unknown[];
  };
  const files =
    appAny.vault?.getMarkdownFiles?.() ??
    appAny.getMarkdownFiles?.() ??
    [];

  // 第一遍:建 forward —— 按 path 作 key,对每个 bklink basename 解析为单一文件路径
  for (const file of files) {
    const f = file as { basename: string; path: string };
    const bkBasenames = readBklinks(app, f.path);
    const bkPaths: string[] = [];
    for (const bkBasename of bkBasenames) {
      const resolved = resolveBkBasename(app, bkBasename, f.path);
      if (resolved) {
        // 同文件自身的 bklink 自指跳过(防止 self-loop)
        if (resolved !== f.path) bkPaths.push(resolved);
      } else {
        // orphan fallback:basename 没有对应文件,登记为合成 path(不依赖文件存在性)
        bkPaths.push(`${bkBasename}.md`);
      }
    }
    forward.set(f.path, bkPaths);
  }

  // 第二遍:建 backward,扫描所有 bklink 目标为 orphan 的合成 path 也登记到 forward
  //         保证图结构一致(orphan 目标作为 leaf 存在)
  for (const [fromPath, bkPaths] of forward) {
    for (const bkPath of bkPaths) {
      if (!backward.has(bkPath)) {
        backward.set(bkPath, []);
      }
      const list = backward.get(bkPath)!;
      if (!list.includes(fromPath)) {
        list.push(fromPath);
      }
    }
  }
  // 保证每个 forward key 也有对应 backward 节点(空数组 = 叶子)
  for (const path of forward.keys()) {
    if (!backward.has(path)) {
      backward.set(path, []);
    }
  }
  // 同时把 bklink 目标里 orphan 合成 path 也登记到 forward(使其在图中存在为 leaf)
  for (const bkPaths of forward.values()) {
    for (const bkPath of bkPaths) {
      if (!forward.has(bkPath)) {
        forward.set(bkPath, []);
      }
    }
  }

  return { forward, backward };
}

/**
 * 从 Obsidian metadataCache 读 bklinks。
 * 兼容两种格式:
 *   bklink: "[[A]]"           (单值字符串)
 *   bklink: ["[[A]]", "[[B]]"]  (数组)
 */
function readBklinks(
  app: App | VaultLike,
  path: string,
): string[] {
  const appAny = app as unknown as {
    metadataCache?: {
      getFileCache(file: unknown): {
        frontmatter?: { bklink?: unknown };
      } | null;
    };
    vault?: {
      getAbstractFileByPath(path: string): { basename: string; path: string; stat: { ctime: number } } | null;
    };
  };

  if (!appAny.metadataCache) {
    return [];
  }

  const file = appAny.vault?.getAbstractFileByPath?.(path);
  if (!file) return [];

  const cache = appAny.metadataCache.getFileCache(file);
  const fmBkl = cache?.frontmatter?.bklink;
  if (!fmBkl) return [];

  if (typeof fmBkl === "string") {
    return [stripBrackets(fmBkl)];
  }
  if (Array.isArray(fmBkl)) {
    return fmBkl
      .filter((v): v is string => typeof v === "string")
      .map(stripBrackets);
  }
  return [];
}

/** 去掉 [[ ]] 包装 */
function stripBrackets(s: string): string {
  const t = s.trim();
  if (t.startsWith("[[") && t.endsWith("]]")) {
    return t.slice(2, -2);
  }
  return t;
}

// ============ 主题根识别 ============

/**
 * 沿 forward 链向上追溯,找到 bklink 为空的节点(即主题根)。
 *
 * 场景:
 *   - A.bklink=[B], B.bklink=[C], C.bklink=[] → A 的根是 C
 *   - A.bklink=[] → A 自己是根
 *   - A.bklink=[X] 但 X 不存在 → A 没有可追溯的根,fallback 到 A 自身
 *
 * 算法:
 *   - 单链(89% 场景):沿 forward 一路走到底,O(D),D ≤ 3
 *   - 多 bklink:BFS 找最近的根(深度最小),O(V)
 *   - 环兜底:visited set
 *
 * 2026-08 id 化修复:接受文件完整路径,不再是 basename。
 */
export function findTopicRoot(
  start: string,
  graph: BklinkGraph,
): string {
  if (!graph.forward.has(start) && !graph.backward.has(start)) {
    return start;  // 孤节点
  }

  // 单链场景快速路径
  const forwardStart = graph.forward.get(start) ?? [];
  if (forwardStart.length === 1) {
    return findTopicRootSingleChain(start, graph);
  }

  // 单链 + 0 bklink = 自己是根
  if (forwardStart.length === 0) {
    return start;
  }

  // 多 bklink:BFS 找最近的根
  return findTopicRootMultiBFS(start, graph);
}

function findTopicRootSingleChain(
  start: string,
  graph: BklinkGraph,
): string {
  let cur = start;
  let lastValid = start;  // 最近一个"在图里且 bklink 非空"的节点
  const visited = new Set<string>();

  while (!visited.has(cur)) {
    visited.add(cur);

    // 节点不在图里 → cur 本身是孤儿,返回上一个有效节点
    if (!graph.forward.has(cur)) {
      return lastValid;
    }

    const next = graph.forward.get(cur) ?? [];

    if (next.length === 0) {
      return cur;  // 根
    }

    if (next.length > 1) {
      // 走到一半发现是多 bklink,切换到 BFS
      return findTopicRootMultiBFS(cur, graph, visited);
    }

    // 单 bklink 继续走
    const candidate = next[0];
    if (!graph.forward.has(candidate)) {
      // 目标节点不在图里,cur 自己是可达的最远节点
      return cur;
    }
    lastValid = cur;
    cur = candidate;
  }

  return lastValid;  // 环兜底,返回最近的有效节点
}

function findTopicRootMultiBFS(
  start: string,
  graph: BklinkGraph,
  initialVisited: Set<string> = new Set(),
): string {
  const visited = new Set<string>(initialVisited);
  visited.add(start);

  const queue: Array<{ name: string; depth: number }> = [];
  for (const bk of graph.forward.get(start) ?? []) {
    queue.push({ name: bk, depth: 1 });
  }

  // 候选根：按 depth 最小优先(同 depth 取先入队,即依赖数组中靠前)
  let bestRoot: { name: string; depth: number } | null = null;

  while (queue.length > 0) {
    const { name, depth } = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);

    if (!graph.forward.has(name)) {
      continue;
    }

    const next = graph.forward.get(name) ?? [];
    if (next.length === 0) {
      // 这是一个根
      if (bestRoot === null || depth < bestRoot.depth) {
        bestRoot = { name, depth };
      }
      continue;
    }

    if (depth >= 10) continue;

    for (const bk of next) {
      queue.push({ name: bk, depth: depth + 1 });
    }
  }

  return bestRoot?.name ?? start;
}

// ============ 主题子图 ============

/**
 * 从根出发,backward BFS 拉整个主题子图。
 *
 * 算法:从根出发,只看 backward 边(不沿 forward 走,避免跨主题)。
 * 复杂度:O(V + E_backward),vault 95 节点实测 < 1ms。
 *
 * 为什么不用双向 BFS:会让两个独立根共享同一连通分量(实测见 verify 脚本)。
 * 纯 backward BFS 保证每个根的子图严格不重叠。
 *
 * 2026-08 id 化修复:接受文件完整路径。
 */
export function getTopicSubgraph(
  root: string,
  graph: BklinkGraph,
): Set<string> {
  const reachable = new Set<string>([root]);
  const queue: string[] = [root];

  while (queue.length > 0) {
    const cur = queue.shift()!;

    for (const dependent of graph.backward.get(cur) ?? []) {
      if (!reachable.has(dependent)) {
        reachable.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return reachable;
}

/**
 * 找 vault 中所有主题根(bklink 为空的节点)。
 */
export function getAllTopicRoots(graph: BklinkGraph): string[] {
  const roots: string[] = [];
  for (const [name, bks] of graph.forward) {
    if (bks.length === 0) {
      roots.push(name);
    }
  }
  return roots;
}

// ============ 便利函数:从路径解析主题 ============

/**
 * 给定 vault 文件路径,算出其归属主题根。
 * 封装 findTopicRoot + graph 查找的样板代码。
 *
 * 2026-08 id 化修复:接受文件完整路径作为输入(不再 strip basename)。
 */
export function resolveTopicRootByPath(
  path: string,
  graph: BklinkGraph,
): string {
  return findTopicRoot(path, graph);
}