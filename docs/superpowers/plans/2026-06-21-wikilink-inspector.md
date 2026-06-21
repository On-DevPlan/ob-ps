# 双链检查侧边栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个独立右侧栏视图，按解析状态分组列出 vault 内所有 `[[ ]]` 双链（每个出现一行，按源笔记创建时间倒序），紧凑预览（每组 5 条 + 加载更多）+ 全量 Modal（搜索/筛选），并与现有进程视图互跳。

**Architecture:** 纯逻辑（`link-row` / `link-collector`）与 Obsidian 依赖隔离——收集器只依赖一个窄接口 `CollectorSource`，便于单测注入假对象、不引入 Obsidian mock。UI 层（`inspector-render` / `inspector-view` / `inspector-modal`）通过适配器把 `app.metadataCache` 喂给纯逻辑。视图间解耦：进程↔双链互跳经 `ViewOptions` 回调注入，不互相 import。

**Tech Stack:** TypeScript + esbuild + Obsidian Plugin API（≥1.7.2），ESM，vitest（纯逻辑单测，本计划新增），eslint（含 `eslint-plugin-obsidianmd`）。

## Global Constraints

- **平台**：仅桌面端（依赖 `child_process` 与 `metadataCache`，移动端不支持）。
- **Obsidian 版本**：≥ 1.7.2。
- **代码风格**：遵循现有约定——文件 200–400 行、`src/<feature>/index.ts` 聚合导出、中文注释、Obsidian `createDiv/createSpan/setIcon` DOM 助手、`type` 导入用 `import type`。
- **Lint 规则**：`eslint-plugin-obsidianmd` 会拦截 `console.log/info/warn/error` 的自定义前缀（调试用 `console.debug`）等；任何提交前必须 `npm run lint` 通过。
- **构建**：`npm run build` = `tsc -noEmit -skipLibCheck && esbuild --production`，产物为根目录 `main.js`。每个 UI 任务结束前必须 build 通过（类型检查）。
- **提交**：Conventional Commits，每个任务结束提交一次，commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。本计划全程**只本地提交、不推送**（用户会话偏好）。
- **新依赖**：本计划 Task 1 新增 devDep `vitest`（仅纯逻辑单测）。如不可接受，请在执行前提出。
- **CSS 命名前缀**：新增样式统一用 `wli-` 前缀（wikilink-inspector），避免与现有 `runner-` 冲突。
- **已决开放问题**（来自 spec 第 9 节，本计划定型）：
  - Modal 打开即快照，不在打开期间跟随实时刷新。
  - 未解析分组为空时：隐藏分组，显示「✓ 暂无未解析双链」友好提示。
  - 巨型 vault 的增量重算：暂不做（当前 vault 很小），全量重算 + 400ms 防抖。
  - 「默认 5 条」硬编码常量 `DEFAULT_PREVIEW = 5`，不做设置项（YAGNI）。

---

## File Structure

| 文件 | 责任 | 新建/修改 |
|------|------|----------|
| `package.json` | 加 `vitest` devDep + `test`/`test:watch` 脚本 | 修改 |
| `vitest.config.ts` | vitest 配置（include `src/**/*.test.ts`） | 新建 |
| `src/wikilink-inspector/link-row.ts` | `LinkRow` 类型 + `sortRowsByCtimeDesc` + `partitionByState` | 新建 |
| `src/wikilink-inspector/link-row.test.ts` | 排序/分组单测 | 新建 |
| `src/wikilink-inspector/link-collector.ts` | `CollectorSource` 接口 + `collectRows` 纯函数 | 新建 |
| `src/wikilink-inspector/link-collector.test.ts` | 收集/分类单测 | 新建 |
| `src/wikilink-inspector/inspector-render.ts` | `renderInspectorRow` + `formatCtime`（视图与 Modal 共用） | 新建 |
| `src/wikilink-inspector/inspector-view.ts` | `WikilinkInspectorView`（ItemView）：预览/折叠/加载更多/刷新/跳转/互跳按钮 | 新建 |
| `src/wikilink-inspector/inspector-modal.ts` | `WikilinkInspectorModal`：全量 + 搜索 + 状态筛选 | 新建 |
| `src/wikilink-inspector/index.ts` | 聚合导出 | 新建 |
| `main.ts` | 注册视图/ribbon/命令 + `activateInspectorView` + 互跳回调接线 | 修改 |
| `src/view/runner-view.ts` | 顶栏加「双链」互跳按钮 + `ViewOptions.onOpenInspector` | 修改 |
| `styles.css` | `wli-` 系列样式（分组/行/Modal） | 修改 |
| `README.md` | 功能列表补「双链检查侧边栏」 | 修改 |

---

## Task 1: 引入 vitest 测试基础设施

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `src/wikilink-inspector/__sanity__.test.ts`（临时的最小自检，Task 2 起被真实测试取代；本任务验证 runner 跑通后删除）

**Interfaces:**
- Produces: `npm test` 可运行；约定测试文件放 `src/**/*.test.ts`，纯逻辑、不 import `obsidian`。

- [ ] **Step 1: 安装 vitest 为 devDep**

Run:
```bash
npm install -D vitest@^2
```
Expected: `package.json` 的 `devDependencies` 出现 `"vitest": "^2.x.x"`，`package-lock.json` 更新。

- [ ] **Step 2: 加 test 脚本到 package.json**

Modify `package.json` 的 `scripts`，在 `"lint"` 后追加两行（注意保留末尾逗号规则，JSON 合法）：

```json
"scripts": {
  "dev": "node esbuild.config.mjs",
  "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs --production",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: 新建 vitest.config.ts**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 写一个最小自检测试验证 runner**

Create `src/wikilink-inspector/__sanity__.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npm test`
Expected: 1 个测试通过，输出 `Test Files 1 passed`。

- [ ] **Step 6: 删除自检文件**

Delete `src/wikilink-inspector/__sanity__.test.ts`（已验证 runner，不再需要）。

- [ ] **Step 7: lint 通过后提交**

Run:
```bash
npm run lint
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): add vitest for pure-logic unit tests" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: link-row.ts — 类型 + 排序/分组（TDD）

**Files:**
- Create: `src/wikilink-inspector/link-row.ts`, `src/wikilink-inspector/link-row.test.ts`

**Interfaces:**
- Produces:
  - `type LinkState = "resolved" | "unresolved"`
  - `interface LinkRow { sourcePath: string; sourceCtime: number; target: string; state: LinkState; position?: { line: number; col: number } }`
  - `sortRowsByCtimeDesc(rows: LinkRow[]): LinkRow[]`（不修改入参，新数组，ctime 降序）
  - `partitionByState(rows: LinkRow[]): { resolved: LinkRow[]; unresolved: LinkRow[] }`（保持原顺序）

- [ ] **Step 1: 写失败测试**

Create `src/wikilink-inspector/link-row.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  sortRowsByCtimeDesc,
  partitionByState,
  type LinkRow,
} from "./link-row";

function row(
  sourcePath: string,
  sourceCtime: number,
  state: LinkRow["state"] = "resolved",
): LinkRow {
  return { sourcePath, sourceCtime, target: "x", state };
}

describe("sortRowsByCtimeDesc", () => {
  it("按 sourceCtime 降序", () => {
    const rows = [row("a.md", 100), row("b.md", 300), row("c.md", 200)];
    expect(sortRowsByCtimeDesc(rows).map((r) => r.sourcePath)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  it("不修改入参数组", () => {
    const rows = [row("a.md", 100), row("b.md", 300)];
    sortRowsByCtimeDesc(rows);
    expect(rows.map((r) => r.sourceCtime)).toEqual([100, 300]);
  });

  it("空数组返回空数组", () => {
    expect(sortRowsByCtimeDesc([])).toEqual([]);
  });
});

describe("partitionByState", () => {
  it("拆分 resolved/unresolved 且保持原顺序", () => {
    const rows = [
      row("a", 1, "resolved"),
      row("b", 2, "unresolved"),
      row("c", 3, "resolved"),
    ];
    const { resolved, unresolved } = partitionByState(rows);
    expect(resolved.map((r) => r.sourcePath)).toEqual(["a", "c"]);
    expect(unresolved.map((r) => r.sourcePath)).toEqual(["b"]);
  });
});
```

> 注：第二条 `不修改入参数组` 的断言写法臃肿，下面实现完成后用清晰的 `sourceCtime` 断言即可（已附带）。如嫌乱可删掉第一行 expect，保留第二个清晰的断言。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: FAIL，报 `Cannot find module './link-row'`（模块还未创建）。

- [ ] **Step 3: 实现 link-row.ts**

Create `src/wikilink-inspector/link-row.ts`:

```ts
/** 双链的解析状态 */
export type LinkState = "resolved" | "unresolved";

/** 列表里的一行：一条 [[ ]] 双链的出现 */
export interface LinkRow {
  /** 源笔记路径，如 "创建链接.md" */
  sourcePath: string;
  /** 源笔记文件创建时间(ms)——排序键 */
  sourceCtime: number;
  /** 链接目标（link 文本，如 "欢迎"） */
  target: string;
  state: LinkState;
  /** 在源笔记中的位置，点击跳转用；frontmatter 链接无此字段 */
  position?: { line: number; col: number };
}

/**
 * 按 sourceCtime 降序返回新数组（最新置顶），不改入参。
 * 同 ctime 时保持原相对顺序（Array.prototype.sort 稳定）。
 */
export function sortRowsByCtimeDesc(rows: LinkRow[]): LinkRow[] {
  return [...rows].sort((a, b) => b.sourceCtime - a.sourceCtime);
}

/** 按状态拆分为两组，保持各组内原顺序 */
export function partitionByState(rows: LinkRow[]): {
  resolved: LinkRow[];
  unresolved: LinkRow[];
} {
  const resolved: LinkRow[] = [];
  const unresolved: LinkRow[] = [];
  for (const r of rows) {
    if (r.state === "unresolved") unresolved.push(r);
    else resolved.push(r);
  }
  return { resolved, unresolved };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add src/wikilink-inspector/link-row.ts src/wikilink-inspector/link-row.test.ts
git commit -m "feat(wikilink-inspector): add LinkRow type and sort/partition helpers" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: link-collector.ts — 收集 LinkRow（TDD）

**Files:**
- Create: `src/wikilink-inspector/link-collector.ts`, `src/wikilink-inspector/link-collector.test.ts`

**Interfaces:**
- Consumes: `LinkRow`, `LinkState` from `./link-row`
- Produces:
  - `interface RawLinkEntry { link: string; position?: { line: number; col: number } }`
  - `interface CollectorSource { listFiles(): { path: string; ctime: number }[]; getLinks(path: string): RawLinkEntry[] | null; unresolvedTargets(path: string): Set<string> }`
  - `collectRows(source: CollectorSource): LinkRow[]` —— 文件按 ctime 降序、每个文件内链接按原顺序；目标命中 `unresolvedTargets` → `"unresolved"`，否则 `"resolved"`；`getLinks` 返回 null 的文件跳过。

- [ ] **Step 1: 写失败测试**

Create `src/wikilink-inspector/link-collector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectRows, type CollectorSource } from "./link-collector";

describe("collectRows", () => {
  it("按 unresolvedTargets 分类，文件按 ctime 降序", () => {
    const src: CollectorSource = {
      listFiles: () => [
        { path: "a.md", ctime: 100 },
        { path: "b.md", ctime: 200 },
      ],
      getLinks: (p) =>
        p === "a.md"
          ? [{ link: "存在" }, { link: "不存在" }]
          : [{ link: "foo" }],
      unresolvedTargets: (p) =>
        p === "a.md" ? new Set(["不存在"]) : new Set(["foo"]),
    };
    const rows = collectRows(src);
    expect(rows).toEqual([
      {
        sourcePath: "b.md",
        sourceCtime: 200,
        target: "foo",
        state: "unresolved",
        position: undefined,
      },
      {
        sourcePath: "a.md",
        sourceCtime: 100,
        target: "存在",
        state: "resolved",
        position: undefined,
      },
      {
        sourcePath: "a.md",
        sourceCtime: 100,
        target: "不存在",
        state: "unresolved",
        position: undefined,
      },
    ]);
  });

  it("跳过 getLinks 返回 null 的文件", () => {
    const src: CollectorSource = {
      listFiles: () => [{ path: "a.md", ctime: 1 }],
      getLinks: () => null,
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)).toEqual([]);
  });

  it("保留 entry 的 position", () => {
    const src: CollectorSource = {
      listFiles: () => [{ path: "a.md", ctime: 1 }],
      getLinks: () => [{ link: "x", position: { line: 5, col: 3 } }],
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)[0]?.position).toEqual({ line: 5, col: 3 });
  });

  it("空 vault 返回空数组", () => {
    const src: CollectorSource = {
      listFiles: () => [],
      getLinks: () => [],
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module './link-collector'`。

- [ ] **Step 3: 实现 link-collector.ts**

Create `src/wikilink-inspector/link-collector.ts`:

```ts
import type { LinkRow, LinkState } from "./link-row";

/** Obsidian 链接 entry 的最小形状（正文 links / frontmatterLinks 共用） */
export interface RawLinkEntry {
  link: string;
  position?: { line: number; col: number };
}

/**
 * 收集器依赖的最小接口——故意不直接依赖 Obsidian App，
 * 便于单测注入假对象。UI 层负责把 app.metadataCache 适配成此接口。
 */
export interface CollectorSource {
  /** 所有 markdown 文件（路径 + 创建时间） */
  listFiles(): { path: string; ctime: number }[];
  /** 某文件的链接 entry（正文 + frontmatter）；文件未解析完返回 null */
  getLinks(path: string): RawLinkEntry[] | null;
  /** 该文件的未解析目标集合（来自 metadataCache.unresolvedLinks[path] 的 keys） */
  unresolvedTargets(path: string): Set<string>;
}

/**
 * 从 source 收集所有 LinkRow。
 * 文件按 ctime 降序遍历，每个文件内链接按原顺序输出。
 */
export function collectRows(source: CollectorSource): LinkRow[] {
  const files = source.listFiles().slice().sort((a, b) => b.ctime - a.ctime);
  const rows: LinkRow[] = [];
  for (const f of files) {
    const links = source.getLinks(f.path);
    if (!links) continue;
    const unresolved = source.unresolvedTargets(f.path);
    for (const link of links) {
      const state: LinkState = unresolved.has(link.link)
        ? "unresolved"
        : "resolved";
      rows.push({
        sourcePath: f.path,
        sourceCtime: f.ctime,
        target: link.link,
        state,
        position: link.position,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add src/wikilink-inspector/link-collector.ts src/wikilink-inspector/link-collector.test.ts
git commit -m "feat(wikilink-inspector): add collectRows with CollectorSource interface" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: inspector-render.ts — 行渲染 + 时间格式化

**Files:**
- Create: `src/wikilink-inspector/inspector-render.ts`

**Interfaces:**
- Consumes: `LinkRow` from `./link-row`
- Produces:
  - `formatCtime(ctime: number): string`（当年 `MM-DD HH:mm`，跨年 `YYYY-MM-DD`，用 Obsidian 的 `window.moment`）
  - `renderInspectorRow(parent: HTMLElement, row: LinkRow, onClick: (row: LinkRow) => void): HTMLElement`（行带状态色点 `wli-dot is-<state>`、目标、源、时间，class `wli-row is-<state>`）

> 本任务为 UI 层（依赖 Obsidian DOM 助手），不写单测；靠 build + lint + 后续 live 验证。

- [ ] **Step 1: 实现 inspector-render.ts**

Create `src/wikilink-inspector/inspector-render.ts`:

```ts
import type { LinkRow } from "./link-row";

/** 源笔记名（去 .md 后缀） */
function sourceBaseName(sourcePath: string): string {
  return sourcePath.replace(/\.md$/i, "");
}

/**
 * 创建时间显示：当年用 MM-DD HH:mm，跨年用 YYYY-MM-DD。
 * 用 Obsidian 注入的全局 moment。
 */
export function formatCtime(ctime: number): string {
  const m = window.moment(ctime);
  const now = window.moment();
  return m.isSame(now, "year") ? m.format("MM-DD HH:mm") : m.format("YYYY-MM-DD");
}

/**
 * 渲染单行双链。视图与 Modal 共用。
 * 行 class: wli-row + is-resolved/is-unresolved；色点 class: wli-dot is-<state>。
 */
export function renderInspectorRow(
  parent: HTMLElement,
  row: LinkRow,
  onClick: (row: LinkRow) => void,
): HTMLElement {
  const el = parent.createDiv({ cls: `wli-row is-${row.state}` });

  el.createDiv({ cls: `wli-dot is-${row.state}` });

  el.createSpan({ cls: "wli-target", text: row.target });

  el.createSpan({
    cls: "wli-source",
    text: `·「${sourceBaseName(row.sourcePath)}」`,
  });

  el.createSpan({ cls: "wli-time", text: formatCtime(row.sourceCtime) });

  el.setAttr("title", `${row.target}\n来自 ${row.sourcePath}`);
  el.addEventListener("click", () => onClick(row));

  return el;
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add src/wikilink-inspector/inspector-render.ts
git commit -m "feat(wikilink-inspector): add row renderer and ctime formatter" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: inspector-view.ts + main.ts 注册（紧凑预览/折叠/加载更多/实时刷新/跳转/互跳按钮）

**Files:**
- Create: `src/wikilink-inspector/inspector-view.ts`, `src/wikilink-inspector/index.ts`
- Modify: `main.ts`（注册视图、ribbon、命令、`activateInspectorView`、`InspectorViewOptions` 接线）

**Interfaces:**
- Consumes: `collectRows`, `CollectorSource` from `./link-collector`; `partitionByState`, `sortRowsByCtimeDesc`, `LinkRow` from `./link-row`; `renderInspectorRow` from `./inspector-render`
- Produces:
  - `export const WIKILINK_INSPECTOR_VIEW_TYPE = "wikilink-inspector-view"`
  - `interface InspectorViewOptions { onOpenRunner: () => void }`
  - `class WikilinkInspectorView extends ItemView`（构造 `(leaf, opts)`）
- main.ts 新增公共方法 `activateInspectorView(): Promise<void>`（镜像现有 `activateView()`）。

> 「查看全部」开 Modal 的按钮放 Task 6（Modal 还不存在），本任务视图先不含该按钮。

- [ ] **Step 1: 实现 inspector-view.ts**

Create `src/wikilink-inspector/inspector-view.ts`:

```ts
import { ItemView, MarkdownView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { collectRows, type CollectorSource, type RawLinkEntry } from "./link-collector";
import { partitionByState, type LinkRow } from "./link-row";
import { renderInspectorRow } from "./inspector-render";

export const WIKILINK_INSPECTOR_VIEW_TYPE = "wikilink-inspector-view";

const DEFAULT_PREVIEW = 5;
const REFRESH_DEBOUNCE_MS = 400;

/** 视图构造参数：onOpenRunner 由 main.ts 绑定到 activateView() */
export interface InspectorViewOptions {
  onOpenRunner: () => void;
}

/** 把 app.metadataCache 适配成纯收集器需要的 CollectorSource */
function makeSource(app: App): CollectorSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        ctime: f.stat.ctime,
      }));
    },
    getLinks(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return null;
      const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);
      if (!cache) return null;
      const entries: RawLinkEntry[] = [];
      for (const l of cache.links ?? []) {
        entries.push({
          link: l.link,
          position: l.position
            ? { line: l.position.start.line, col: l.position.start.col }
            : undefined,
        });
      }
      for (const l of cache.frontmatterLinks ?? []) {
        entries.push({ link: l.link }); // frontmatter 链接无 position
      }
      return entries;
    },
    unresolvedTargets(path) {
      const map = app.metadataCache.unresolvedLinks[path] ?? {};
      return new Set(Object.keys(map));
    },
  };
}

export class WikilinkInspectorView extends ItemView {
  private rows: LinkRow[] = [];
  private readonly limit: Record<"resolved" | "unresolved", number> = {
    resolved: DEFAULT_PREVIEW,
    unresolved: DEFAULT_PREVIEW,
  };
  private readonly collapsed: Record<"resolved" | "unresolved", boolean> = {
    resolved: false,
    unresolved: false,
  };
  private debounceTimer: number | null = null;
  private readonly opts: InspectorViewOptions;
  private listEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, opts: InspectorViewOptions) {
    super(leaf);
    this.opts = opts;
  }

  getViewType(): string {
    return WIKILINK_INSPECTOR_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "双链检查";
  }
  getIcon(): string {
    return "link";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.refresh();
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.scheduleRefresh()),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh()),
    );
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
  }

  // ---- UI ----

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "wli-view" });

    const header = root.createDiv({ cls: "wli-header" });
    header.createSpan({ cls: "wli-title", text: "双链检查" });

    const right = header.createDiv({ cls: "wli-header-right" });

    const refreshBtn = right.createDiv({ cls: "wli-header-btn", title: "刷新" });
    setIcon(refreshBtn, "refresh-ccw");
    refreshBtn.addEventListener("click", () => this.refresh());

    const runnerBtn = right.createDiv({ cls: "wli-header-btn", title: "进程管理" });
    setIcon(runnerBtn, "play");
    runnerBtn.addEventListener("click", () => this.opts.onOpenRunner());

    this.listEl = root.createDiv({ cls: "wli-list" });
  }

  // ---- 数据 ----

  private refresh(): void {
    this.rows = collectRows(makeSource(this.app));
    this.renderAll();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // ---- 渲染 ----

  private renderAll(): void {
    this.listEl.empty();
    const { resolved, unresolved } = partitionByState(this.rows);

    this.renderSection("unresolved", "未解析", unresolved);
    this.renderSection("resolved", "已解析", resolved);
  }

  private renderSection(
    key: "resolved" | "unresolved",
    label: string,
    rows: LinkRow[],
  ): void {
    // 未解析为空：友好提示，不渲染分组
    if (key === "unresolved" && rows.length === 0) {
      const empty = this.listEl.createDiv({ cls: "wli-empty" });
      empty.createSpan({ text: "✓ 暂无未解析双链" });
      return;
    }

    const section = this.listEl.createDiv({
      cls: `wli-section is-${key}` + (this.collapsed[key] ? " is-collapsed" : ""),
    });

    const head = section.createDiv({ cls: "wli-section-head" });
    const chevron = head.createDiv({ cls: "wli-chevron" });
    setIcon(chevron, this.collapsed[key] ? "chevron-right" : "chevron-down");
    head.createDiv({ cls: `wli-dot is-${key}` });
    head.createSpan({ cls: "wli-section-title", text: `${label} (${rows.length})` });
    head.addEventListener("click", () => {
      this.collapsed[key] = !this.collapsed[key];
      this.renderAll();
    });

    const body = section.createDiv({ cls: "wli-section-body" });
    if (this.collapsed[key]) {
      body.style.display = "none";
    }

    const shown = rows.slice(0, this.limit[key]);
    for (const r of shown) {
      renderInspectorRow(body, r, (row) => this.openSource(row));
    }

    // 加载更多
    if (rows.length > this.limit[key]) {
      const more = body.createDiv({
        cls: "wli-load-more",
        text: `加载更多 +${DEFAULT_PREVIEW}（剩 ${rows.length - this.limit[key]}）`,
      });
      more.addEventListener("click", () => {
        this.limit[key] += DEFAULT_PREVIEW;
        this.renderAll();
      });
    }
  }

  // ---- 跳转 ----

  private async openSource(row: LinkRow): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(row.sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (row.position && view instanceof MarkdownView) {
      const { line, col } = row.position;
      const editor = view.editor;
      editor.setCursor({ line, ch: col });
      editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true,
      );
    }
  }
}
```

- [ ] **Step 2: 新建 index.ts 聚合导出**

Create `src/wikilink-inspector/index.ts`:

```ts
export type { LinkRow, LinkState } from "./link-row";
export { sortRowsByCtimeDesc, partitionByState } from "./link-row";
export type { CollectorSource, RawLinkEntry } from "./link-collector";
export { collectRows } from "./link-collector";
export { renderInspectorRow, formatCtime } from "./inspector-render";
export {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
} from "./inspector-view";
```

- [ ] **Step 3: 在 main.ts 注册视图/ribbon/命令 + activateInspectorView**

Modify `main.ts`：

(a) 顶部 import 区追加（在现有 `import { applyWikilinkStyle } ...` 之后）：

```ts
import {
  WIKILINK_INSPECTOR_VIEW_TYPE,
  WikilinkInspectorView,
  type InspectorViewOptions,
} from "./src/wikilink-inspector";
```

(b) 在 `onload()` 内、现有「9. 命令面板入口」之后追加视图注册与命令：

```ts
    // 10. 注册「双链检查」视图
    this.registerView(WIKILINK_INSPECTOR_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const opts: InspectorViewOptions = {
        onOpenRunner: () => void this.activateView(),
      };
      return new WikilinkInspectorView(leaf, opts);
    });

    // 11. 双链检查：ribbon + 命令
    this.addRibbonIcon("link", "双链检查", () => {
      void this.activateInspectorView();
    });
    this.addCommand({
      id: "open-wikilink-inspector",
      name: "打开双链检查侧边栏",
      callback: () => {
        void this.activateInspectorView();
      },
    });
```

(c) 在类内（紧挨现有 `activateView()` 方法之后）新增公共方法：

```ts
  /** 激活(或首次创建)双链检查侧边栏视图 */
  async activateInspectorView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(WIKILINK_INSPECTOR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({
        type: WIKILINK_INSPECTOR_VIEW_TYPE,
        active: true,
      });
    }
    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 5: live 验证（真机）**

构建产物同步到测试 vault 并热加载（参考 `.claude/skills/ob-ps-work-flow`；或手动）：
```bash
npm run build
# 把 main.js 同步到测试 vault 的插件目录（dev 模式自动同步；这里用 build 后手动 cp）
cp main.js "D:/DevProjects/my/test/test/obsidian/123/.obsidian/plugins/local-runner/main.js"
```
在 Obsidian 里 disable→enable 插件（或重启）使新视图类型生效，然后：
- 左侧 ribbon 出现 `link` 图标，点击 → 右侧栏出现「双链检查」标签。
- 看到「未解析 / 已解析」两组，各显示前 5 条（若 vault 不足则更少），最新笔记链接置顶。
- 点「加载更多」→ 该组多出 5 条。
- 点分组标题 → 折叠/展开。
- 点一行 → 打开对应源笔记，光标落到链接所在行。
- 改一篇笔记加一条 `[[新悬空链]]` → ~400ms 后「未解析」组实时出现该行。
- 顶栏 `play` 按钮 → 切到「本地进程」视图。

> 若没有现成「已解析 + 未解析」双链的测试笔记，临时建一篇：内容 `已解析：[[欢迎]]\n未解析：[[某不存在xyz]]`。

- [ ] **Step 6: 提交**

```bash
git add src/wikilink-inspector/inspector-view.ts src/wikilink-inspector/index.ts main.ts
git commit -m "feat(wikilink-inspector): add sidebar view with preview, load-more, live refresh" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: inspector-modal.ts + 「查看全部」入口

**Files:**
- Create: `src/wikilink-inspector/inspector-modal.ts`
- Modify: `src/wikilink-inspector/inspector-view.ts`（顶栏加「查看全部」按钮 → 开 Modal）、`src/wikilink-inspector/index.ts`（导出 Modal）

**Interfaces:**
- Consumes: `LinkRow`, `partitionByState`, `renderInspectorRow`, `formatCtime`
- Produces: `class WikilinkInspectorModal extends Modal`（构造 `(app, rows: LinkRow[])`）

> Modal 打开即快照当前 rows，不在打开期间跟随刷新（Global Constraints 已定）。

- [ ] **Step 1: 实现 inspector-modal.ts**

Create `src/wikilink-inspector/inspector-modal.ts`:

```ts
import { MarkdownView, Modal, TFile } from "obsidian";
import type { App } from "obsidian";
import { partitionByState, type LinkRow } from "./link-row";
import { renderInspectorRow } from "./inspector-render";

type Filter = "all" | "resolved" | "unresolved";

export class WikilinkInspectorModal extends Modal {
  private readonly allRows: LinkRow[];
  private filter: Filter = "all";
  private query = "";

  constructor(app: App, rows: LinkRow[]) {
    super(app);
    this.allRows = rows;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const root = this.contentEl.createDiv({ cls: "wli-modal" });

    const header = root.createDiv({ cls: "wli-modal-header" });
    header.createSpan({
      cls: "wli-modal-title",
      text: `双链检查 — 共 ${this.allRows.length}`,
    });

    // 搜索框
    const search = header.createEl("input", {
      cls: "wli-modal-search",
      attr: { type: "search", placeholder: "搜索源/目标…" },
    }) as HTMLInputElement;
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.rerenderList(listWrap);
    });

    // 状态筛选
    const filters = root.createDiv({ cls: "wli-modal-filters" });
    const chips: { key: Filter; label: string }[] = [
      { key: "all", label: "全部" },
      { key: "unresolved", label: "未解析" },
      { key: "resolved", label: "已解析" },
    ];
    for (const c of chips) {
      const chip = filters.createDiv({
        cls: "wli-chip" + (this.filter === c.key ? " is-active" : ""),
        text: c.label,
      });
      chip.addEventListener("click", () => {
        this.filter = c.key;
        this.render();
      });
    }

    const listWrap = root.createDiv({ cls: "wli-modal-list" });
    this.rerenderList(listWrap);
  }

  private rerenderList(wrap: HTMLElement): void {
    wrap.empty();
    const q = this.query.trim().toLowerCase();
    const matches = (r: LinkRow): boolean => {
      if (this.filter !== "all" && r.state !== this.filter) return false;
      if (!q) return true;
      return (
        r.target.toLowerCase().includes(q) ||
        r.sourcePath.toLowerCase().includes(q)
      );
    };
    const { resolved, unresolved } = partitionByState(this.allRows);
    const drawGroup = (label: string, rows: LinkRow[], key: string): void => {
      const filtered = rows.filter(matches);
      if (filtered.length === 0) return;
      const sec = wrap.createDiv({ cls: `wli-modal-group is-${key}` });
      sec.createDiv({ cls: "wli-modal-group-title", text: `${label} (${filtered.length})` });
      for (const r of filtered) {
        renderInspectorRow(sec, r, (row) => {
          this.openSource(row);
        });
      }
    };
    drawGroup("未解析", unresolved, "unresolved");
    drawGroup("已解析", resolved, "resolved");
    if (wrap.children.length === 0) {
      wrap.createDiv({ cls: "wli-empty", text: "无匹配结果" });
    }
  }

  /** 关闭 Modal 并打开源笔记，光标定位到链接行 */
  private async openSource(row: LinkRow): Promise<void> {
    this.close();
    const file = this.app.vault.getAbstractFileByPath(row.sourcePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (row.position && view instanceof MarkdownView) {
      const { line, col } = row.position;
      view.editor.setCursor({ line, ch: col });
      view.editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true,
      );
    }
  }
}
```

- [ ] **Step 2: index.ts 导出 Modal**

Modify `src/wikilink-inspector/index.ts`，追加一行：

```ts
export { WikilinkInspectorModal } from "./inspector-modal";
```

- [ ] **Step 3: 视图顶栏加「查看全部」按钮**

Modify `src/wikilink-inspector/inspector-view.ts`：

(a) 顶部 import 追加 Modal：
```ts
import { WikilinkInspectorModal } from "./inspector-modal";
```

(b) 在 `buildUi()` 的 `right` 容器里，**在 `runnerBtn` 之前**插入「查看全部」按钮：
```ts
    const allBtn = right.createDiv({ cls: "wli-header-btn", title: "查看全部" });
    setIcon(allBtn, "layout-grid");
    allBtn.addEventListener("click", () => {
      new WikilinkInspectorModal(this.app, this.rows).open();
    });
```

（`runnerBtn` 紧随其后，顺序：刷新 → 查看全部 → 进程。）

- [ ] **Step 4: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错（确保 Modal 用的是干净版 openSource，无占位行）。

- [ ] **Step 5: live 验证**

同步 `main.js` 到测试 vault → disable/enable 插件 → 打开双链检查视图：
- 顶栏出现 `layout-grid`（查看全部）按钮，点击 → 弹出 Modal，列出全量。
- 搜索框输入目标/源关键词 → 列表实时过滤。
- 点 `未解析` / `已解析` / `全部` chip → 切换筛选。
- 点一行 → 关闭 Modal 并打开源笔记定位到链接行。

- [ ] **Step 6: 提交**

```bash
git add src/wikilink-inspector/inspector-modal.ts src/wikilink-inspector/index.ts src/wikilink-inspector/inspector-view.ts
git commit -m "feat(wikilink-inspector): add full-list modal with search and state filter" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 互跳（进程视图侧）—— RunnerView 顶栏「双链」按钮

**Files:**
- Modify: `src/view/runner-view.ts`（`ViewOptions` 加 `onOpenInspector`、`buildUi` 顶栏加按钮）、`main.ts`（`buildViewOptions` 注入回调）

**Interfaces:**
- Consumes: `ViewOptions`（扩字段）
- Produces: `ViewOptions.onOpenInspector: () => void`（新增必填字段）

- [ ] **Step 1: ViewOptions 加字段**

Modify `src/view/runner-view.ts`，在 `ViewOptions` interface 内追加：

```ts
export interface ViewOptions {
  defaultCwd: string;
  settings: PluginSettings;
  onSaveConfigs: (configs: ProcessConfig[]) => void;
  /** 顶栏「双链」按钮：切到双链检查视图 */
  onOpenInspector: () => void;
}
```

- [ ] **Step 2: buildUi 顶栏加「双链」按钮**

Modify `src/view/runner-view.ts` 的 `buildUi()`，在 `settingsBtn`（gear）**之前**插入：

```ts
    const inspectorBtn = headerRight.createDiv({
      cls: "runner-header-btn",
      title: "双链检查",
    });
    setIcon(inspectorBtn, "link");
    inspectorBtn.addEventListener("click", () => this.opts.onOpenInspector());
```

（顶栏顺序变为：双链 → 设置 → 新建。）

- [ ] **Step 3: main.ts buildViewOptions 注入回调**

Modify `main.ts` 的 `buildViewOptions()`，在返回对象里追加：

```ts
  private buildViewOptions(): ViewOptions {
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
      onOpenInspector: () => void this.activateInspectorView(),
    };
  }
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 5: live 验证**

同步 `main.js` → disable/enable：
- 进程视图顶栏出现 `link`（双链）按钮，点击 → 切到「双链检查」视图。
- 双链视图顶栏 `play` 按钮 → 切回进程视图。双向互跳顺畅。
- 两个视图在右侧栏并存为标签（顶部标签栏可点切换）。

- [ ] **Step 6: 提交**

```bash
git add src/view/runner-view.ts main.ts
git commit -m "feat(view): add cross-link button in runner header to open wikilink inspector" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: styles.css —— 双链检查样式

**Files:**
- Modify: `styles.css`（追加 `wli-` 系列样式，**不动**现有 `runner-` / `ob-ps-hl-wl` 规则）

**Interfaces:** 无（纯样式）。

- [ ] **Step 1: 追加样式**

在 `styles.css` **末尾**追加：

```css
/* ===== Wikilink Inspector (wli-) ===========================================
 * 双链检查侧边栏 + Modal。状态色复用笔记内高亮：已解析蓝、未解析绿。
 * 不与 runner- / ob-ps-hl-wl 规则冲突。
 * ========================================================================== */

.wli-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.wli-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.wli-title {
  font-weight: 600;
  font-size: var(--font-ui-medium);
}
.wli-header-right {
  display: flex;
  align-items: center;
  gap: 2px;
}
.wli-header-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.wli-header-btn:hover {
  background: var(--interactive-hover);
  color: var(--text-normal);
}

.wli-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.wli-empty {
  color: var(--text-faint);
  text-align: center;
  padding: 16px 8px;
  font-size: var(--font-ui-small);
}

/* 分组 */
.wli-section {
  margin: 0 8px 6px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  overflow: hidden;
}
.wli-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  user-select: none;
  background: var(--background-secondary);
}
.wli-section-head:hover {
  background: var(--background-modifier-hover);
}
.wli-chevron {
  display: flex;
  color: var(--text-muted);
}
.wli-section.is-collapsed .wli-section-body {
  display: none;
}
.wli-section-title {
  font-weight: 600;
  font-size: var(--font-ui-small);
}

/* 状态色点（蓝=已解析，绿=未解析，与笔记内高亮一致） */
.wli-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wli-dot.is-resolved {
  background: #1d4ed8;
}
.wli-dot.is-unresolved {
  background: #15803d;
}
.theme-dark .wli-dot.is-resolved {
  background: #93c5fd;
}
.theme-dark .wli-dot.is-unresolved {
  background: #86efac;
}

/* 行 */
.wli-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s;
}
.wli-row:hover {
  background: var(--background-modifier-hover);
}
.wli-target {
  font-weight: 500;
  color: var(--text-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wli-source {
  color: var(--text-muted);
  font-size: var(--font-smaller);
  flex-shrink: 0;
}
.wli-time {
  color: var(--text-faint);
  font-size: var(--font-smaller);
  margin-left: auto;
  flex-shrink: 0;
}

/* 加载更多 */
.wli-load-more {
  text-align: center;
  padding: 6px;
  margin: 2px 10px 4px;
  border-radius: 4px;
  color: var(--text-muted);
  font-size: var(--font-smaller);
  cursor: pointer;
}
.wli-load-more:hover {
  background: var(--background-modifier-hover);
  color: var(--interactive-accent);
}

/* ---- Modal ---- */
.wli-modal {
  min-width: 480px;
  max-width: 720px;
}
.wli-modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.wli-modal-title {
  font-weight: 600;
  white-space: nowrap;
}
.wli-modal-search {
  flex: 1;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  outline: none;
}
.wli-modal-search:focus {
  border-color: var(--interactive-accent);
}
.wli-modal-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.wli-chip {
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
  font-size: var(--font-smaller);
  color: var(--text-muted);
}
.wli-chip:hover {
  background: var(--background-modifier-hover);
}
.wli-chip.is-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-color: var(--interactive-accent);
}
.wli-modal-list {
  max-height: 60vh;
  overflow-y: auto;
}
.wli-modal-group {
  margin-bottom: 6px;
}
.wli-modal-group-title {
  font-weight: 600;
  font-size: var(--font-ui-small);
  padding: 4px 10px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: 构建 + lint**

Run: `npm run build && npm run lint`
Expected: 无报错。

- [ ] **Step 3: live 视觉验证**

同步 `main.js` + `styles.css` 到测试 vault → disable/enable：
- 侧边栏分组有圆角卡片、状态色点（蓝/绿）正确。
- 行 hover 有底色，加载更多按钮可点。
- Modal 弹出尺寸合理，搜索框/chip/列表样式正常，暗色主题下色点仍清晰（手动切暗色主题确认）。

- [ ] **Step 4: 提交**

```bash
git add styles.css
git commit -m "style(wikilink-inspector): add wli- styles for view, rows, and modal" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: README 更新 + 端到端验证

**Files:**
- Modify: `README.md`

**Interfaces:** 无。

- [ ] **Step 1: README 功能列表补条目**

Modify `README.md`，在中文「功能」段的「附加能力（面向 Claude Code 用户）」列表里（`高亮双链样式` 之后）追加一项：

```markdown
- 🔗 **双链检查侧边栏** — 独立侧边栏视图，按解析状态分组列出所有 `[[ ]]` 双链（已解析蓝 / 未解析绿），按源笔记创建时间倒序，默认每组 5 条、可加载更多，「查看全部」打开全量 Modal（搜索/筛选）；与进程面板顶栏一键互跳
```

并在英文 `## Features` 列表（`Highlighted wikilinks` 之后）追加：

```markdown
- 🔗 **Wikilink inspector sidebar** — a separate sidebar view listing every `[[ ]]` link grouped by resolved (blue) / unresolved (green), newest source-note first, 5-per-group preview with load-more, and a full-list modal with search/filter; one-click switch to/from the process panel
```

- [ ] **Step 2: 全量构建 + lint + 测试**

Run:
```bash
npm run build && npm run lint && npm test
```
Expected: 全部通过，无报错。

- [ ] **Step 3: live 端到端验证清单**

同步产物到测试 vault → disable/enable，逐项确认：
- [ ] ribbon `link` 图标 / 命令「打开双链检查侧边栏」能打开视图。
- [ ] 两组分组正确，状态色点蓝/绿，排序为最新源笔记置顶。
- [ ] 加载更多、折叠/展开、点行跳源笔记定位、实时刷新（新增悬空链 ~400ms 后出现）。
- [ ] 「查看全部」Modal：搜索、状态筛选、点行跳转。
- [ ] 双链视图↔进程视图互跳按钮、右侧栏标签并存切换。
- [ ] 暗色主题下可读。
- [ ] 卸载/重装后视图类型能正确反序列化（重启 Obsidian，已停靠的 inspector leaf 仍在）。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs(wikilink-inspector): document the wikilink inspector sidebar feature" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成标准

- 9 个任务全部完成并提交（本地，未推送）。
- `npm run build && npm run lint && npm test` 全绿。
- live 端到端清单全部勾选。
- `dev` 分支领先 `main` 若干提交，待用户决定合并/推送时机。
