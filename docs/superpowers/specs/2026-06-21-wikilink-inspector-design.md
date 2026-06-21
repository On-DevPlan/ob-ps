# 双链检查侧边栏 — 设计文档

- **日期**: 2026-06-21
- **状态**: 已通过设计评审，待写实现计划
- **所属插件**: ob-ps (Local Runner)
- **作者**: brainstorming 协作产出

## 1. 背景与目标

当前 `src/wikilink/` 只在笔记内给双链上色（已解析蓝 / 未解析绿），**没有全局浏览入口**。用户希望在侧边栏里看到整个 vault 的双链状态全貌，快速定位最新笔记里的链接、尤其找出未解析（悬空）的链接去修复。

**目标**：一个独立侧边栏视图，按解析状态分组列出所有 `[[ ]]` 双链，按源笔记创建时间倒序，紧凑预览 + 全量 Modal 查看两种粒度。

**非目标（YAGNI）**：
- 不做链接的批量自动修复（已有独立的 `obsidian-repair-unresolved-links` skill）
- 不做图谱可视化
- 不做跨 vault 统计

## 2. 已确认决策

| 决策点 | 结论 |
|--------|------|
| 列表粒度 | 每个 `[[x]]` **出现** = 一行（不去重），按**源笔记文件创建时间** `file.stat.ctime` 排序，最新置顶 |
| 放置位置 | **新建独立 `ItemView`**（`wikilink-inspector-view`），与进程面板平级，自带 ribbon 图标 + 命令 |
| 详情查看 | 「查看全部」打开 **Modal**（轻量），侧边栏内另有「加载更多 +5」逐步展开 |
| 刷新策略 | **实时（防抖 ~400ms）**：监听 `metadataCache` 的 `resolved`/`changed` 事件重算 |
| 点击行 | **打开源笔记并跳到该链接所在行**（与反向链接面板行为一致，已/未解析统一） |
| 视图切换 | 原生标签栏 / ribbon / 命令三入口；**额外在两视图顶栏加互跳按钮**（进程↔双链一键切换） |

## 3. 数据模型

```ts
type LinkState = "resolved" | "unresolved";

interface LinkRow {
  sourcePath: string;        // 源笔记路径，如 "创建链接.md"
  sourceCtime: number;       // 源笔记 file.stat.ctime（毫秒）—— 排序键
  target: string;            // 已解析=目标路径；未解析=目标名（无对应文件）
  state: LinkState;
  position?: { line: number; col: number };  // 点击跳转用，懒加载
}
```

**收集逻辑**（纯函数，可单测）：
1. 取所有 markdown 文件，按 `stat.ctime` 降序
2. 对每个文件取 `metadataCache.getFileCache(file).links` 与 `.frontmatterLinks`
3. 逐条分类：目标出现在 `metadataCache.unresolvedLinks[sourcePath]` → `unresolved`，否则 `resolved`
4. 输出 `LinkRow[]`，附带 `position`（来自 link entry）

> **设计说明**：用 `getFileCache().links` 而非聚合的 `resolvedLinks`/`unresolvedLinks` map，是为了 (a) 忠实「每个出现=一行」、(b) 直接拿到 `position` 供点击跳转。两者结合用于状态分类。

## 4. UI 设计

### 4.1 侧边栏视图（紧凑预览）

- 顶栏：标题「双链检查」+ 刷新按钮 ⟳ + 「查看全部」▢（开 Modal）
- 两个可折叠分组：`未解析 (N)` / `已解析 (N)`，默认展开
- 每组默认渲染 **5 条**（按 `sourceCtime` 降序）
- 每行：状态色点（🟢未解析 / 🔵已解析，复用笔记内高亮配色）+ 目标名 + 源笔记名 + 相对时间
- 组底：`[ 加载更多 +5 ]`（每次追加 5 条）+ `[ 查看全部 → ]`（开 Modal）

```
┌─ 双链检查 ─────────────  ⟳  ▢ ┐
│ ▾ 未解析 (3)  🟢                │
│   某不存在笔记  ·「笔记A」 06-21 14:30│
│   foo bar       ·「笔记B」 06-21 09:12│
│   …                             │
│   [ 加载更多 +5 ]  [ 查看全部 →]│
│                                 │
│ ▾ 已解析 (27)  🔵                │
│   欢迎   ·「创建链接」 06-19 19:37 │
│   …                             │
│   [ 加载更多 +5 ]  [ 查看全部 →]│
└─────────────────────────────────┘
```

### 4.2 Modal（全量详情）

- 标题：`双链检查 — 共 N`
- 搜索框：按源/目标文本过滤
- 状态筛选 chips：`[全部] [未解析] [已解析]`
- 全量列表（同序、同行样式），可滚动
- 点行行为同侧边栏（打开源笔记跳行）

```
┌─ 双链检查 — 共 30 ───────────────── ✕ ┐
│ 🔍 搜索源/目标…     [全部][未解析][已解析]│
│───────────────────────────────────────│
│ 🟢 某不存在笔记  ·「笔记A」 · 06-21 14:30 │
│ 🟢 foo bar       ·「笔记B」 · 06-21 09:12│
│ …                                     │
│ 🔵 欢迎   ·「创建链接」 · 06-19 19:37   │
└─────────────────────────────────────────┘
```

## 4.3 视图切换与导航

两个视图（进程 / 双链检查）都是独立 `ItemView`，停靠在右侧栏，**并存为标签页**。切换有三条原生入口：

1. **右侧栏顶部标签栏** —— 两视图各一个图标标签（`play` 进程 / `link` 双链），点标签切换（主要方式）
2. **左侧 ribbon 图标** —— 每个视图自己的 ribbon 图标，点 → `revealLeaf` 切到对应标签
3. **命令面板** —— 「打开本地进程侧边栏」/「打开双链检查侧边栏」

**互跳按钮（增量）**：两视图顶栏各加一个小图标按钮，一键激活对方视图：
- 双链视图顶栏：`play` 图标按钮 → 激活进程视图
- 进程视图顶栏：`link` 图标按钮 → 激活双链视图

互跳通过插件实例（main.ts）持有的 `activateRunnerView()` / `activateInspectorView()` 实现（内部 `getLeavesOfType` 复用 + `revealLeaf` 切标签），经 `ViewOptions` 回调注入视图，**两视图不直接耦合对方**。

## 5. 组件拆分

遵循现有 `src/<feature>/` 目录惯例与小文件原则（200–400 行/文件）：

```
src/wikilink-inspector/
├── index.ts              // 对外导出
├── link-row.ts           // LinkRow 类型 + 排序/分组辅助
├── link-collector.ts     // 纯函数：从 metadataCache 收集 LinkRow[]（可单测）
├── inspector-render.ts   // 把行渲染进容器（视图与 Modal 共用）
├── inspector-view.ts     // ItemView：紧凑预览 + 折叠 + 加载更多 + 顶栏「进程」互跳按钮
└── inspector-modal.ts    // Modal：全量 + 搜索 + 状态筛选
```

`main.ts` 改动：
- `registerView(WIKILINK_INSPECTOR_VIEW_TYPE, ...)`
- `addRibbonIcon("link", "双链检查", openInspector)`
- `addCommand({ id: "open-wikilink-inspector", name: "打开双链检查侧边栏", ... })`
- `activateInspectorView()`（参考现有 `activateView()`，用 `getRightLeaf`）
- 修改现有 `RunnerView.buildUi()`：顶栏加「双链」按钮，点击调 `onOpenInspector`
- `ViewOptions` 增加互跳回调 `onOpenInspector`（runner 用）/ `onOpenRunner`（inspector 用），由 main.ts 绑定到对应 `activate*()`

## 6. 数据流与刷新

```
metadataCache 事件 (resolved / changed)
        │  (debounce 400ms)
        ▼
link-collector.collectRows(app)  →  LinkRow[]
        │
        ├── inspector-view:    按 state 分组 → 各取前 5 → 渲染
        └── inspector-modal:   按当前搜索/筛选 → 全量渲染
```

- 视图 `onOpen` 时计算一次；之后靠事件实时刷新
- Modal 打开时基于最新数据渲染；打开期间也跟随事件刷新（或简单起见打开时快照一次——见开放问题）
- 防抖避免边打字边频繁全量重算

## 7. 交互细节

- **折叠**：点分组标题切换展开/收起，状态记在视图实例内存（不持久化）
- **加载更多**：每组维护 `limit`（初始 5），点一次 +5，仅影响该组
- **点行**：`app.workspace.getLeaf(false).openFile(sourceFile)` 打开源笔记，拿到 MarkdownView 后用 `editor.setCursor({ line, ch: col })` 并对该行 `scrollIntoView` 跳到 `position`
- **空状态**：`未解析 (0)` → 显示「✓ 无未解析双链」；分组为空时折叠或隐藏（待定，见开放问题）
- **时间显示**：当年用 `MM-DD HH:mm`，跨年用 `YYYY-MM-DD`（用 Obsidian 自带 `moment`）

## 8. 边界与错误处理

- 源笔记被删除：下次重算自动消失（事件驱动）
- `getFileCache` 返回 null（文件未解析完）：跳过该文件，不报错
- 巨型 vault：全量重算 O(链接总数)，靠防抖控制频率；如需进一步优化可只重算变更文件（开放问题）
- frontmatter 里的 `[[ ]]`：`.frontmatterLinks` 已覆盖，与正文链接同等处理

## 9. 开放问题（实现阶段再定，不阻塞）

1. Modal 打开期间是否跟随实时刷新，还是打开即快照？
2. 分组为空时：折叠收起 vs 完全隐藏？
3. 巨型 vault 的增量重算优化是否需要？（当前 vault 很小，先全量）
4. 「默认显示条数 5」是否做成设置项？（先硬编码，YAGNI）

## 10. 测试要点

- `link-collector` 纯函数：造 fixture metadataCache，验证分类正确、排序正确、frontmatter 链接被收集
- 排序：相同 ctime 的稳定性、跨日/跨月顺序
- 未解析目标名含特殊字符（`|` 别名、`#` 锚点、`^` 块引用）的处理
