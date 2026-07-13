import { ItemView, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { ProcessConfig } from "../types/process";
import type { CommandGroup } from "../types/commands";
import type { PluginSettings } from "../types/settings";
import {
  isRunning,
  launchProcess,
  pickFirstVisibleGroup,
  resolveOrCreateTab,
  type ProcChangeKind,
  type RunnerTab,
  stopProcess,
} from "../runner";
import { collectRows } from "../wikilink-inspector/link-collector";
import { partitionByState, dedupeRowsByTarget, type LinkRow } from "../wikilink-inspector/link-row";
import { renderInspectorRow } from "../wikilink-inspector/inspector-render";
import { ClearUnresolvedConfirmModal } from "../wikilink-inspector/clear-unresolved-modal";
import { makeUnresolvedSource } from "../wikilink-inspector/clear-unresolved";
import { type FormMode } from "./process-form";
import { TreeLinkView } from "../link-tree/link-tree-view";
import { refreshLinkTree } from "../link-tree/refresh-link-tree";
import { filterByActiveNote } from "../link-tree/link-tree-view";
import type { CreationEvent } from "../link-tree/creation-event";
import { applyTreeZoneVisibility } from "./tree-zone-visibility";
import { toggleTreeBody } from "./tree-zone-body";

export const MERGED_VIEW_TYPE = "merged-runner-inspector-view";

const DEFAULT_PREVIEW = 5;
const REFRESH_DEBOUNCE_MS = 400;

export interface MergedViewOptions {
  defaultCwd: string;
  settings: PluginSettings;
  onSaveConfigs: (configs: ProcessConfig[]) => void;
  onSaveCommandGroups: (groups: CommandGroup[]) => void;
  /** 返回当前 linkTree 事件列表（由 main.ts 在捕获后更新） */
  getLinkTreeEvents: () => CreationEvent[];
  /** 用户点击 tree scan 按钮时调用,触发 vault 扫描 */
  onTreeScan?: (activeNotePath: string) => Promise<void>;
  /** 当前 active note 的 topicRoot 折叠状态（持久化） */
  getCollapsed?: () => string[];
  /** 折叠状态变化时通知 main.ts 持久化 */
  onCollapsedChange?: (topicRoot: string, collapsed: string[]) => void;
  /**
   * 进程成功退出 + 启用了 rescanOnExit 时,通知 main.ts 重新扫描。
   * tab 含 rescanOnExit + rescanTargetPath 字段。
   */
  onProcessExit?: (tab: RunnerTab) => void | Promise<void>;
}

// makeSource 已抽到 wikilink-inspector/link-source(便于 link-tree 复用,避免反向依赖 view)
import { makeSource } from "../wikilink-inspector/link-source";
export { makeSource };

// buildBklinkGraph 在每次 filter 调用前重建一次(vault 规模小,O(V+E) < 1ms)
import { buildBklinkGraph } from "../link-tree/topic-resolver";

export class MergedRunnerInspectorView extends ItemView {
  // WLI state
  private rows: LinkRow[] = [];
  private readonly limit: Record<"resolved" | "unresolved", number> = {
    resolved: DEFAULT_PREVIEW,
    unresolved: DEFAULT_PREVIEW,
  };
  private debounceTimer: number | null = null;

  // Runner state
  private tabs: RunnerTab[] = [];
  private readonly expandedIds = new Set<string>();
  private rafScheduled = false;
  private expandScrollId: string | null = null;
  private formMode: FormMode | null = null;
  private editingTabId: string | null = null;
  private readonly outputElMap = new Map<string, HTMLElement>();
  private dragSourceId: string | null = null;

  /** 待应用的配置(onOpen 前收到时暂存) */
  private pendingConfigs: ProcessConfig[] | null = null;

  private readonly opts: MergedViewOptions;

  // DOM 缓存
  private actionsZoneEl!: HTMLElement;
  private procBtnGridEl!: HTMLElement;
  private wliZoneEl!: HTMLElement;
  private wliBodyEl!: HTMLElement;
  private wliChevronEl!: HTMLElement;
  private wliCollapsed = false;
  private procZoneEl!: HTMLElement;
  private procBodyEl!: HTMLElement;
  private procChevronEl!: HTMLElement;
  private procCollapsed = false;
  private logSectionVisible = false;
  private logBtnEl!: HTMLElement;
  /** 完善历史树 —— 链接历史可视化 */
  private treeView!: TreeLinkView;
  private treeZoneEl!: HTMLElement;
  private treeBodyEl!: HTMLElement;
  private treeContainerEl!: HTMLElement;
  private treeLoadingEl!: HTMLElement;
  private treeContainerVisible = false;
  private treeBodyCollapsed = false;       // internal body collapse — independent of treeContainerVisible
  private treeChevronEl!: HTMLElement;     // head chevron — cached for setIcon in toggleTreeBody
  private treeToggleBtnEl!: HTMLElement;
  private treeScanBtnEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, opts: MergedViewOptions) {
    super(leaf);
    this.opts = opts;
    this.treeView = new TreeLinkView(
      (event) => {
        // 跳转到目标笔记（event.target），不是 bklink 前置（event.sourcePath）
        void this.openSource({
          sourcePath: this.findBasenamePath(event.target) ?? event.sourcePath,
          position: event.position,
          target: event.target,
          state: "resolved",
          sourceCtime: event.firstSeenAt,
        });
        // WLI 列表走 400ms 防抖(重算行成本高)
        this.scheduleWliRefresh();
        // 树立刻更新(不防抖),立刻高亮 + 动画到源文件节点
        const newActive = this.getActiveNotePath();
        const treeGraph = buildBklinkGraph(this.app);
        const treeEvents = filterByActiveNote(this.opts.getLinkTreeEvents(), newActive, treeGraph);
        this.treeView.updateFromApp(treeEvents, this.app, newActive);
      },
      {
        // 折叠状态:从 opts.getCollapsed 获取,变化时通过 opts.onCollapsedChange 持久化
        initialCollapsed: opts.getCollapsed ? opts.getCollapsed() : undefined,
        onCollapsedChange: opts.onCollapsedChange,
      },
    );
  }

  getViewType(): string {
    return MERGED_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Local runner";
  }
  getIcon(): string {
    return "link";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.refreshWli();
    // 用户切到不同笔记(主区 active leaf 变化)→ 树立即高亮新节点
    // 这个监听器与进程生命周期无关,常驻
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const newActive = this.getActiveNotePath();
        const treeGraph = buildBklinkGraph(this.app);
        const treeEvents = filterByActiveNote(this.opts.getLinkTreeEvents(), newActive, treeGraph);
        this.treeView.updateFromApp(treeEvents, this.app, newActive);
      }),
    );
    // WLI 列表热刷新：vault 中任何 .md 完成链接解析(新建/修改) → 重算 unresolved。
    // 否则用户在某条笔记里写下 [[target]] 后,侧边栏列表不会即时出现该未解析。
    //
    // 必须用 'changed' 而不是 'resolved':
    //   - 'changed' : 文件索引更新即触发(覆盖新写入的 [[target]])
    //   - 'resolved': 仅在该文件「所有 [[]] 都能解析」时触发 —— target 不存在时不会触发,
    //                  这正是 wikilink 检查的需求场景,选错事件导致列表永不更新。
    // 见 https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/on
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.scheduleWliRefresh();
      }),
    );
    if (this.pendingConfigs) {
      this.setTabsFromConfigs(this.pendingConfigs);
      this.pendingConfigs = null;
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    for (const tab of this.tabs) {
      if (tab.child) {
        stopProcess(tab, () => {});
      }
    }
    try { this.treeView.destroy(); } catch { /* ok */ }
  }

  // ---- Public API for main.ts -----------------------------------------------

  /** 设置 tab 改动 commandGroups 后调用,让侧边栏快速按钮栏重建 */
  notifyCommandGroupsChanged(): void {
    if (!this.procBtnGridEl) return; // view 还没 buildUi(onOpen 之前)
    this.syncTabsWithCommandGroups();
    this.refreshQuickBar();
  }

  /** linkTreeEvents 改动后按当前活动笔记立即重投影 Canvas。 */
  notifyLinkTreeChanged(): void {
    const activePath = this.getActiveNotePath();
    refreshLinkTree({
      events: this.opts.getLinkTreeEvents(),
      activePath,
      graph: buildBklinkGraph(this.app),
      filter: filterByActiveNote,
      update: (events, path) => this.treeView.updateFromApp(events, this.app, path),
      onError: (error) => console.warn("[link-tree] update failed", error),
    });
  }

  /**
   * 把 tabs 与 commandGroups(visible:true)双向同步:
   *
   * 1. 删除:tab 对应的 command 已不在任何 visible:true 命令组中 → 终止并移除
   * 2. 同步字段:从第一个可见命令组复制 name / cwd 到 tab
   *    - cwd 改了不重启子进程(下次启动生效)
   *    - name 仅改字段,UI 跟随重渲染
   *
   * 注:同一 command 可能出现在多个命令组中(数据模型允许);这里以"任一可见
   * 命令组救活 tab + 取第一个可见命令组的字段"为准,与 pruneOrphanTabs 用
   * command 作 key 的旧语义保持一致。
   */
  private syncTabsWithCommandGroups(): void {
    const groups = this.opts.settings.commandGroups ?? [];
    const visibleCmds = new Set(groups.filter((g) => g.visible !== false).map((g) => g.command));
    const firstVisibleByCommand = new Map<string, CommandGroup>();
    for (const g of groups) {
      if (g.visible === false) continue;
      if (!firstVisibleByCommand.has(g.command)) {
        firstVisibleByCommand.set(g.command, g);
      }
    }

    // 1) 删除:command 已不在可见命令组中的 tab
    const orphans = this.tabs.filter((t) => !visibleCmds.has(t.command));
    if (orphans.length > 0) {
      const orphanIds = new Set(orphans.map((t) => t.id));
      for (const tab of orphans) {
        if (tab.child) {
          stopProcess(tab, (kind) => this.onProcChange(tab.id, kind));
        }
        this.expandedIds.delete(tab.id);
        this.outputElMap.delete(tab.id);
      }
      this.tabs = this.tabs.filter((t) => !orphanIds.has(t.id));
    }

    // 2) 同步字段:每个保留 tab 从对应可见命令组拉 name / cwd / rescanOnExit
    for (const tab of this.tabs) {
      const g = firstVisibleByCommand.get(tab.command);
      if (!g) continue; // 上面已过滤,这里不该发生,但防御性兜底
      tab.name = g.name;
      tab.cwd = g.cwd;
      tab.rescanOnExit = g.rescanOnExit === true;
    }

    this.saveConfigs();
    this.renderProcAll();
  }

  setTabsFromConfigs(configs: ProcessConfig[]): void {
    if (!this.procBodyEl) {
      this.pendingConfigs = configs;
      return;
    }
    this.tabs = configs.map((c) => ({
      id: c.id,
      name: c.name,
      command: c.command,
      cwd: c.cwd,
      status: "stopped",
      exitCode: null,
      output: "",
      child: null,
      generation: 0,
    }));
    this.expandedIds.clear();
    this.outputElMap.clear();
    this.renderProcAll();
  }

  startOrCreateTab(name: string, command: string, cwd: string, rescanOnExit = false): RunnerTab {
    const { tab, created } = resolveOrCreateTab(this.tabs, name, command, cwd, rescanOnExit);
    if (created) {
      this.tabs.push(tab);
      this.expandedIds.add(tab.id);
      this.expandScrollId = tab.id;
      this.saveConfigs();
      this.renderProcAll();
    }
    this.launchTab(tab);
    return tab;
  }

  /**
   * 统一执行一次进程启动:同步当前 command group 字段、记录扫描目标、
   * 始终注册 onProcessExit 回调。首次创建与退出/停止后重启共用此入口,
   * 避免「重复运行时丢失退出回调」导致自动重新扫描失效。
   */
  private launchTab(tab: RunnerTab): void {
    launchProcess({
      tab,
      group: pickFirstVisibleGroup(this.opts.settings.commandGroups ?? [], tab.command),
      activeNotePath: this.getActiveNotePath(),
      defaultCwd: this.opts.defaultCwd,
      onChange: (kind) => this.onProcChange(tab.id, kind),
      onExit: (t) => this.opts.onProcessExit?.(t),
    });
  }

  findTabByCommand(command: string): RunnerTab | null {
    return this.tabs.find((t) => t.command === command) ?? null;
  }

  /** 展开修复 tab 并滚动到此(替代 revealRunnerTab leaf 切换) */
  revealProcTab(tab: RunnerTab): void {
    this.expandedIds.add(tab.id);
    this.expandScrollId = tab.id;
    this.renderProcAll();
    const el = this.procBodyEl.querySelector(`[data-id="${tab.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---- UI Build -------------------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "merged-view" });

    // ① Header
    const header = root.createDiv({ cls: "merged-header" });
    header.createSpan({ cls: "merged-title", text: "Local runner" });

    const headerRight = header.createDiv({ cls: "merged-header-right" });

    const settingsBtn = headerRight.createDiv({ cls: "clickable-icon", title: "设置" });
    setIcon(settingsBtn, "gear");
    settingsBtn.addEventListener("click", () => void this.openSettings());

    // ===== Zone 1: 进程快捷操作 (auto-size) =====
    this.actionsZoneEl = root.createDiv({ cls: "merged-zone merged-zone-actions" });

    // Process quick-bar (flex-wrap, auto-sized)
    this.procBtnGridEl = this.actionsZoneEl.createDiv({ cls: "btn-process-bar" });
    this.refreshQuickBar();

    // Utility row: 日志 + 完善 + 双链树 三个同大小工具按钮
    const utilityRow = this.actionsZoneEl.createDiv({ cls: "proc-utility-row" });

    this.logBtnEl = utilityRow.createDiv({ cls: "proc-util-btn", title: "查看日志" });
    setIcon(this.logBtnEl, "terminal");
    this.logBtnEl.createSpan({ text: "日志" });
    this.logBtnEl.addEventListener("click", () => this.toggleLogSection());

    // 双链树 切换按钮 → 显示/隐藏 整个 tree zone
    this.treeToggleBtnEl = utilityRow.createDiv({
      cls: "proc-util-btn",
      title: "显示双链树",
    });
    setIcon(this.treeToggleBtnEl, "git-branch");
    this.treeToggleBtnEl.createSpan({ text: "显示双链树" });
    this.treeToggleBtnEl.addEventListener("click", () => this.toggleTreeContainer());

    // ===== Zone 2: 双链列表（未解析 + 最新已解析） =====
    this.wliZoneEl = root.createDiv({ cls: "merged-zone merged-zone-wli" });
    this.buildWliSection();

    // ===== Zone 2.5: 双链树（独立 zone,隐藏时完全脱离布局） =====
    this.treeZoneEl = root.createDiv({ cls: "merged-zone merged-zone-tree is-hidden" });
    this.buildTreeSection();

    // ===== Zone 3: 终端输出 (hidden by default) =====
    this.procZoneEl = root.createDiv({ cls: "merged-zone merged-zone-proc is-collapsed" });
    this.buildProcSection();

    // DnD
    this.setupDragEvents();
  }

  // ---- Action Bar -----------------------------------------------------------

  private refreshQuickBar(): void {
    this.procBtnGridEl.empty();
    const groups = this.opts.settings.commandGroups ?? [];
    const visible = groups.filter((g) => g.visible !== false);
    console.debug("[DBG refreshQuickBar] visible groups:", visible.map((g) => g.name));

    for (const group of visible) {
      const tab = this.tabs.find((t) => t.command === group.command);
      this.appendQuickBtn(
        group.name,
        tab
          ? () => {
            void this.toggleProcess(tab);
          }
          : () => this.startOrCreateTab(
              group.name,
              group.command,
              group.cwd || this.opts.defaultCwd,
              group.rescanOnExit,
            ),
        tab,
      );
    }
  }

  /** 渲染单个进程快捷按钮 */
  private appendQuickBtn(
    name: string,
    onClick: () => void,
    tab?: RunnerTab | null,
  ): void {
    const isRunn = tab ? isRunning(tab) : false;
    const isExErr = tab ? tab.status === "exited-err" : false;
    const btn = this.procBtnGridEl.createDiv({
      cls: `proc-quick-btn${isRunn ? " status-running" : isExErr ? " status-exited-err" : ""}`,
      title: `${name}${tab ? " — " + (isRunn ? "运行中,点击停止" : isExErr ? "已退出,点击重启" : "已停止,点击启动") : " — 点击启动"}`,
    });
    if (isRunn) btn.createSpan({ cls: "dot yellow" });
    else if (isExErr) btn.createSpan({ cls: "dot red" });
    else btn.createSpan({ cls: "dot gray" });
    btn.createSpan({ text: name });
    btn.addEventListener("click", onClick);
  }

  // ---- WLI ------------------------------------------------------------------

  private buildWliSection(): void {
    const head = this.wliZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-down");
    head.createSpan({ cls: "zone-head-title", text: "双链列表" });
    this.wliChevronEl = chevron;

    // 清除全部按钮:把 [[x]] 转成 [x] 语法清除
    const clearBtn = head.createDiv({
      cls: "wli-action-btn",
      title: "将所有未解析 [[x]] 转成 [x] (清除未解析状态)",
    });
    setIcon(clearBtn, "eraser");
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onClearUnresolvedClick();
    });
    head.appendChild(clearBtn);

    this.wliBodyEl = this.wliZoneEl.createDiv({ cls: "zone-wli-body" });

    head.addEventListener("click", () => {
      this.wliCollapsed = !this.wliCollapsed;
      setIcon(this.wliChevronEl, this.wliCollapsed ? "chevron-right" : "chevron-down");
      this.wliBodyEl.toggleClass("is-collapsed", this.wliCollapsed);
      this.wliZoneEl.toggleClass("is-shrunk", this.wliCollapsed);
    });
  }

  /** 构建独立「双链树」区块:隐藏时整个 zone 消失,不占位 */
  private buildTreeSection(): void {
    const head = this.treeZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-down");
    this.treeChevronEl = chevron;
    head.createSpan({ cls: "zone-head-title", text: "双链树" });
    this.treeScanBtnEl = head.createDiv({
      cls: "tree-scan-btn clickable-icon",
      attr: { title: "生成当前页面的双链树" },
    });
    setIcon(this.treeScanBtnEl, "list-tree");
    this.treeScanBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.onTreeScanClick();
    });

    this.treeBodyEl = this.treeZoneEl.createDiv({ cls: "zone-tree-body" });
    this.treeContainerEl = activeDocument.createElement("div");
    this.treeContainerEl.className = "wli-tree-container";
    this.treeBodyEl.appendChild(this.treeContainerEl);

    try {
      this.treeView.mount(this.treeContainerEl);
    } catch (e) {
      console.warn("[link-tree] mount failed", e);
    }

    // loading overlay —— 扫描生成树时显示转圈,绝对定位覆盖 canvas
    this.treeLoadingEl = this.treeContainerEl.createDiv({ cls: "tree-loading-overlay" });
    this.treeLoadingEl.createDiv({ cls: "tree-spinner" });

    // Head click collapses ONLY the canvas body — zone stays in layout
    // (and also shrinks to head-only height via toggleTreeBody's treeZoneEl dep).
    // Scan button's click handler calls e.stopPropagation() so it never reaches here.
    head.addEventListener("click", (e) => {
      if (this.treeScanBtnEl.contains(e.target as Node)) return;
      this.treeBodyCollapsed = toggleTreeBody(
        { collapsed: this.treeBodyCollapsed },
        {
          bodyEl: this.treeBodyEl,
          chevronEl: this.treeChevronEl,
          setIcon,
          treeZoneEl: this.treeZoneEl,
        },
      ).collapsed;
    });
    applyTreeZoneVisibility({
      treeZoneEl: this.treeZoneEl,
      toggleBtnEl: this.treeToggleBtnEl,
      visible: this.treeContainerVisible,
      setIcon,
    });
  }

  private async onTreeScanClick(): Promise<void> {
    const activePath = this.getActiveNotePath();
    console.debug("[scan] onTreeScanClick enter, activePath=", activePath);
    if (!activePath) {
      new Notice("请先打开一篇笔记");
      return;
    }

    if (!this.opts.onTreeScan) {
      console.warn("[scan] onTreeScan callback not provided");
      return;
    }

    // Ensure the zone is visible — icon click may happen even if the user
    // hasn't toggled the tree zone open yet (icon sits in the zone header,
    // so this only fires when the zone is shown, but defensive).
    if (!this.treeContainerVisible) {
      console.debug("[scan] zone hidden, auto-open");
      this.toggleTreeContainer();
    }

    this.treeScanBtnEl.toggleClass("is-loading", true);
    this.treeContainerEl.addClass("is-loading");
    try {
      await this.opts.onTreeScan(activePath);
      console.debug("[scan] onTreeScan callback done");
      // Force tree refresh — linkTreeEvents changed in main.ts
      const events = this.opts.getLinkTreeEvents();
      console.debug("[scan] getLinkTreeEvents returned", events.length, "events");
      const graph = buildBklinkGraph(this.app);
      console.debug("[scan] buildBklinkGraph done, forward=", graph.forward.size, "backward=", graph.backward.size);
      const filtered = filterByActiveNote(events, activePath, graph);
      console.debug("[scan] filterByActiveNote returned", filtered.length, "events");
      console.debug("[scan] calling treeView.updateFromApp, canvas container size =",
        this.treeContainerEl?.clientWidth, "x", this.treeContainerEl?.clientHeight);
      this.treeView.updateFromApp(filtered, this.app, activePath);
      console.debug("[scan] treeView.updateFromApp done");
      // User-facing success/failure Notice is owned by main.ts (onTreeScanClicked),
      // which knows the nodeCount — don't double-fire here.
    } catch (err) {
      console.warn("[scan] tree scan failed", err);
    } finally {
      this.treeContainerEl.removeClass("is-loading");
      this.treeScanBtnEl.toggleClass("is-loading", false);
    }
  }

  private refreshWli(): void {
    this.rows = collectRows(makeSource(this.app));
    this.renderWliAll();
    // 完善历史树:有事件或已挂载则更新
    try {
      const events = this.opts.getLinkTreeEvents();
      if (events.length || this.treeContainerEl?.isConnected) {
        const activePath = this.getActiveNotePath();
        const treeGraph = buildBklinkGraph(this.app);
        const treeEvents = filterByActiveNote(events, activePath, treeGraph);
        this.treeView.updateFromApp(treeEvents, this.app, activePath);
      }
    } catch (e) {
      console.warn("[link-tree] update failed", e);
    }
  }

  /** 双链树切换按钮点击 —— 显示/隐藏整个 tree zone */
  private toggleTreeContainer(): void {
    this.treeContainerVisible = !this.treeContainerVisible;
    applyTreeZoneVisibility({
      treeZoneEl: this.treeZoneEl,
      toggleBtnEl: this.treeToggleBtnEl,
      visible: this.treeContainerVisible,
      setIcon,
    });
    if (this.treeContainerVisible) {
      // 首次展开时主动触发一次更新,确保 canvas 拿到正确尺寸
      const events = this.opts.getLinkTreeEvents();
      const activePath = this.getActiveNotePath();
      const treeGraph = buildBklinkGraph(this.app);
      const treeEvents = filterByActiveNote(events, activePath, treeGraph);
      this.treeView.updateFromApp(treeEvents, this.app, activePath);
    }
  }

  /** 当前打开的 MarkdownView —— 用于 link-tree 跳转与作用域过滤 */
  private getTargetMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView) return leaf.view;
    }
    return null;
  }

  /** 当前打开笔记的路径（用于 link-tree 作用域过滤） */
  private getActiveNotePath(): string | null {
    return this.getTargetMarkdownView()?.file?.path ?? null;
  }

  /** 按 basename 找 vault 中的文件路径（例如点击树节点时跳转用） */
  private findBasenamePath(basename: string): string | null {
    const files = this.app.vault.getMarkdownFiles();
    return files.find((f) => f.basename === basename)?.path ?? null;
  }

  /** 清除未解析双链:[[x]] → [x] 语法清除(基于正则 + unresolved 过滤) */
  private onClearUnresolvedClick(): void {
    const unresolved = makeUnresolvedSource(this.app);
    const allFiles = unresolved.listMarkdownFiles();
    if (allFiles.length === 0) {
      new Notice("没有可处理的文件");
      return;
    }

    // 先统计总条数
    let totalCount = 0;
    for (const f of allFiles) {
      const links = unresolved.getFileLinks(f.path);
      if (!links) continue;
      const set = unresolved.getUnresolvedTargets(f.path);
      totalCount += links.filter((l) => set.has(l.link)).length;
    }
    if (totalCount === 0) {
      new Notice("没有未解析双链");
      return;
    }

    new ClearUnresolvedConfirmModal(this.app, totalCount, {
      onConfirm: () => void this.runClearUnresolved(),
    }).open();
  }

  /**
   * 实际替换:用正则匹配每个文件中的 [[...]],只替换 unresolved 列表里的 target。
   * 不依赖 metadataCache.position 的 start/end offset,避开 0/1-based 与 inclusive/exclusive 歧义。
   */
  private async runClearUnresolved(): Promise<void> {
    const source = makeUnresolvedSource(this.app);
    const linkRegex = /\[\[([^\]\n]+)\]\]/g;
    let totalApplied = 0;
    let filesTouched = 0;

    for (const f of source.listMarkdownFiles()) {
      const unresolvedSet = source.getUnresolvedTargets(f.path);
      if (unresolvedSet.size === 0) continue;

      const file = this.app.vault.getAbstractFileByPath(f.path);
      if (!(file instanceof TFile)) continue;

      const original = await this.app.vault.read(file);
      const text = original.charCodeAt(0) === 0xfeff ? original.slice(1) : original;

      // 收集这个文件中所有未解析双链的替换操作
      const ops: { offset: number; len: number; replacement: string }[] = [];
      let m: RegExpExecArray | null;
      linkRegex.lastIndex = 0;
      while ((m = linkRegex.exec(text)) !== null) {
        const inside = m[1];
        // 取 target(处理 alias [[a|b]])
        const pipeIdx = inside.indexOf("|");
        const target = (pipeIdx >= 0 ? inside.slice(0, pipeIdx) : inside).trim();
        if (!unresolvedSet.has(target)) continue;
        const replacement = "[" + (pipeIdx >= 0 ? inside.slice(pipeIdx + 1) : inside) + "]";
        ops.push({ offset: m.index, len: m[0].length, replacement });
      }

      if (ops.length === 0) continue;

      // 降序替换,避免偏移漂移
      ops.sort((a, b) => b.offset - a.offset);
      let out = text;
      for (const o of ops) {
        out = out.slice(0, o.offset) + o.replacement + out.slice(o.offset + o.len);
      }

      if (out !== text) {
        await this.app.vault.modify(file, out);
        totalApplied += ops.length;
        filesTouched++;
      }
    }

    new Notice(`已清除 ${totalApplied} 条未解析双链（${filesTouched} 个文件）`);
    this.refreshWli();
  }

  private scheduleWliRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refreshWli();
    }, REFRESH_DEBOUNCE_MS);
  }

  private renderWliAll(): void {
    this.wliBodyEl.empty();

    const { unresolved, resolved } = partitionByState(this.rows);
    const dedupedResolved = dedupeRowsByTarget(resolved);
    const resolvedLimit = this.opts.settings.resolvedRecentLimit ?? 10;
    const shownResolved = dedupedResolved.slice(0, resolvedLimit);

    const titleEl = this.wliZoneEl.querySelector(".zone-head-title");
    if (titleEl) {
      titleEl.setText(`双链列表 · 未解析 ${unresolved.length} · 已解析 ${shownResolved.length}/${dedupedResolved.length}`);
    }

    this.renderWliSubsection({
      title: "未解析双链",
      emptyText: "没有未解析双链",
      rows: unresolved,
      state: "unresolved",
      limit: this.limit.unresolved,
      onLoadMore: () => {
        this.limit.unresolved += DEFAULT_PREVIEW;
        this.renderWliAll();
      },
    });

    this.renderWliSubsection({
      title: "最新已解析双链",
      emptyText: "暂无已解析双链",
      rows: dedupedResolved,
      state: "resolved",
      limit: resolvedLimit,
      onLoadMore: null,
    });
  }

  private renderWliSubsection(options: {
    title: string;
    emptyText: string;
    rows: LinkRow[];
    state: "resolved" | "unresolved";
    limit: number;
    onLoadMore: (() => void) | null;
  }): void {
    const section = this.wliBodyEl.createDiv({ cls: `wli-subsection is-${options.state}` });
    section.createDiv({
      cls: "wli-subsection-title",
      text: `${options.title} (${Math.min(options.rows.length, options.limit)}/${options.rows.length})`,
    });

    if (options.rows.length === 0) {
      section.createDiv({ cls: "wli-empty", text: options.emptyText });
      return;
    }

    const shown = options.rows.slice(0, options.limit);
    for (const r of shown) {
      renderInspectorRow(section, r, (row) => void this.openSource(row));
    }

    if (options.onLoadMore && options.rows.length > options.limit) {
      const more = section.createDiv({
        cls: "wli-load-more",
        text: `加载更多 +${DEFAULT_PREVIEW}（剩 ${options.rows.length - options.limit}）`,
      });
      more.addEventListener("click", options.onLoadMore);
    }
  }

  /** 设置页改动「最新已解析双链数量」后调用:view 已 build 时即时重渲 */
  notifyResolvedLimitChanged(): void {
    this.renderWliAll();
  }

  // ---- 进程日志 Section ------------------------------------------------------

  private buildProcSection(): void {
    const head = this.procZoneEl.createDiv({ cls: "zone-head" });
    const chevron = head.createDiv({ cls: "zone-head-cv" });
    setIcon(chevron, "chevron-right");
    head.createSpan({ cls: "zone-head-title", text: "终端输出" });
    this.procChevronEl = chevron;

    this.procBodyEl = this.procZoneEl.createDiv({ cls: "zone-proc-body" });

    // collapse whole zone by default
    this.procCollapsed = true;

    head.addEventListener("click", () => {
      this.procCollapsed = !this.procCollapsed;
      setIcon(this.procChevronEl, this.procCollapsed ? "chevron-right" : "chevron-down");
      this.procBodyEl.toggleClass("is-collapsed", this.procCollapsed);
      this.procZoneEl.toggleClass("is-shrunk", this.procCollapsed);
    });
  }

  /** 切换日志区块显示/隐藏 */
  private toggleLogSection(): void {
    this.logSectionVisible = !this.logSectionVisible;
    this.procZoneEl.toggleClass("is-collapsed", !this.logSectionVisible);
    this.logBtnEl.toggleClass("is-active", this.logSectionVisible);
    if (this.logSectionVisible) {
      setIcon(this.logBtnEl, "eye-off");
      // update log-btn text
      const span = this.logBtnEl.querySelector("span");
      if (span) span.setText("隐藏日志");
    } else {
      setIcon(this.logBtnEl, "terminal");
      const span = this.logBtnEl.querySelector("span");
      if (span) span.setText("日志");
    }
    // 展开时同步展开 zone body
    if (this.logSectionVisible && this.procCollapsed) {
      this.procCollapsed = false;
      setIcon(this.procChevronEl, "chevron-down");
      this.procBodyEl.removeClass("is-collapsed");
    }
  }

  /**
   * runner 回调统一入口:
   * - "status": 状态/句柄变化 —— 立即全量重渲(边框/状态点/顶部快速栏)
   * - "data":   文本流追加 —— 进 RAF 节流,只 patch 已展开 tab 的输出
   *
   * status 用同步重渲(发生频率极低),data 用 RAF(高频时一帧一次)。
   * 原因:status 变化意味着 CSS class 集合改变,必须重建 DOM;
   *       data 只是同 buffer 追加,保留滚动位置/避免抖动至关重要。
   */
  private onProcChange(tabId: string, kind: ProcChangeKind): void {
    if (kind === "status") {
      this.renderProcAll();
      return;
    }
    this.scheduleProcRender(tabId);
  }

  private scheduleProcRender(_changedTabId: string): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    window.requestAnimationFrame(() => {
      this.rafScheduled = false;
      for (const tab of this.tabs) {
        if (!this.expandedIds.has(tab.id)) continue;
        const outputEl = this.outputElMap.get(tab.id);
        if (!outputEl) continue;
        outputEl.setText(tab.output || "");
        const nearBottom =
          outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 30;
        if (this.expandScrollId === tab.id || nearBottom) {
          outputEl.scrollTop = outputEl.scrollHeight;
        }
      }
      this.expandScrollId = null;
    });
  }

  private renderProcAll(): void {
    this.procBodyEl.empty();
    this.outputElMap.clear();
    this.refreshQuickBar();

    const titleEl = this.procZoneEl.querySelector(".zone-head-title");
    if (titleEl) {
      titleEl.setText(`终端输出 (${this.tabs.length})`);
    }

    if (this.tabs.length === 0 && !this.formMode) {
      this.procBodyEl.createDiv({
        cls: "proc-empty",
        text: "暂无进程,在设置 > 命令组管理中添加快捷命令",
      });
      return;
    }

    for (const tab of this.tabs) {
      if (this.formMode === "edit" && tab.id === this.editingTabId) continue;
      const { outputEl } = this.renderProcCard(tab);
      this.outputElMap.set(tab.id, outputEl);
    }
  }

  /** 渲染单个进程日志卡片（仅查看输出，无操作按钮） */
  private renderProcCard(tab: RunnerTab): { outputEl: HTMLElement } {
    const isRunn = isRunning(tab);
    const isExOk = tab.status === "exited-ok";
    const isExErr = tab.status === "exited-err";
    const isExpanded = this.expandedIds.has(tab.id);

    const statusClass = isRunn ? "status-running" : isExOk ? "status-exited-ok" : isExErr ? "status-exited-err" : "status-stopped";

    const item = this.procBodyEl.createDiv({ cls: "proc-item" });
    item.setAttr("data-id", tab.id);
    item.setAttr("draggable", "true");

    const card = item.createDiv({
      cls: `proc-card ${statusClass}`,
    });

    // 状态指示点
    card.createDiv({ cls: `proc-dot ${statusClass}` });

    // 进程名
    card.createSpan({ cls: "proc-name", text: tab.name });

    // 状态文字 (颜色由 CSS 类 .proc-status.status-* 提供, 不再内联 style)
    const statusText = isRunn ? "运行中" : isExOk ? "正常退出" : isExErr ? `异常退出 (${tab.exitCode})` : "已停止";
    card.createSpan({
      cls: `proc-status ${statusClass}`,
      text: statusText,
    });

    // 展开/收起箭头
    const expandIcon = card.createDiv({ cls: "proc-expand" });
    setIcon(expandIcon, isExpanded ? "chevron-up" : "chevron-down");

    // 卡片点击 = toggle 日志
    card.addEventListener("click", () => this.toggleProcExpand(tab.id));

    // 日志输出区
    const body = item.createDiv({
      cls: `proc-body${isExpanded ? "" : " is-collapsed"}`,
    });
    const outputEl = body.createDiv({ cls: "proc-output" });
    if (tab.output) {
      outputEl.setText(tab.output);
    } else {
      outputEl.createSpan({ cls: "proc-output-empty", text: "暂无输出" });
    }

    if (isExpanded && this.expandScrollId === tab.id) {
      item.scrollIntoView({ behavior: "smooth", block: "nearest" });
      this.expandScrollId = null;
    }

    return { outputEl };
  }

  private toggleProcExpand(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
      this.expandScrollId = id;
    }
    this.renderProcAll();
  }

  // ---- 进程操作 (启停编辑删除) ------------------------------------------------

  /** 按钮点击行为:running → stop;其他(含 stopped / exited-ok / exited-err)→ start */
  private async toggleProcess(tab: RunnerTab): Promise<void> {
    if (isRunning(tab)) {
      stopProcess(tab, (kind) => this.onProcChange(tab.id, kind));
      return;
    }

    // exited-* / stopped → 经统一 launchTab 启动;startProcess 入口处的 child 空判断
    // 与 generation 自增保证旧子进程不会污染新进程,launchTab 保证退出回调已注册。
    this.launchTab(tab);
  }

  // ---- 辅助方法 --------------------------------------------------------------

  private saveConfigs(): void {
    this.opts.onSaveConfigs(
      this.tabs.map((t) => ({
        id: t.id,
        name: t.name,
        command: t.command,
        cwd: t.cwd,
      })),
    );
  }



  private async openSettings(): Promise<void> {
    const app = this.app as unknown as {
      setting: { open(): Promise<void>; openTabById(id: string): void };
    };
    await app.setting.open();
    app.setting.openTabById("local-runner");
  }

  private async openSource(row: LinkRow): Promise<void> {
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

  // ---- 拖拽排序 (HTML5 DnD) --------------------------------------------------

  private setupDragEvents(): void {
    this.procBodyEl.addEventListener("dragstart", (e: DragEvent) => {
      const card = (e.target as HTMLElement).closest(".proc-card");
      if (!card) { e.preventDefault(); return; }
      const item = card.closest<HTMLElement>(".proc-item");
      if (!item) { e.preventDefault(); return; }
      const id = item.dataset.id;
      if (!id) { e.preventDefault(); return; }
      this.dragSourceId = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      item.addClass("is-dragging");
    });

    this.procBodyEl.addEventListener("dragend", () => {
      this.cleanDragState();
      this.dragSourceId = null;
    });

    this.procBodyEl.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault();
      const item = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
      if (!item) return;
      this.procBodyEl.querySelectorAll(".is-drag-over").forEach((el) =>
        el.removeClass("is-drag-over"),
      );
      item.addClass("is-drag-over");
    });

    this.procBodyEl.addEventListener("dragleave", (e: DragEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
      if (!item) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && item.contains(related)) return;
      item.removeClass("is-drag-over");
    });

    this.procBodyEl.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData("text/plain") ?? this.dragSourceId;
      const targetItem = (e.target as HTMLElement).closest<HTMLElement>(".proc-item");
      if (!draggedId || !targetItem) return;
      const targetId = targetItem.dataset.id;
      if (!targetId || draggedId === targetId) return;
      const fromIdx = this.tabs.findIndex((t) => t.id === draggedId);
      const toIdx = this.tabs.findIndex((t) => t.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = this.tabs.splice(fromIdx, 1);
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      this.tabs.splice(adjustedTo, 0, moved);
      this.cleanDragState();
      this.dragSourceId = null;
      this.saveConfigs();
      this.renderProcAll();
    });
  }

  private cleanDragState(): void {
    this.procBodyEl?.querySelectorAll(".is-dragging, .is-drag-over").forEach((el) =>
      (el as HTMLElement).removeClass("is-dragging", "is-drag-over"),
    );
  }
}

export { DEFAULT_SETTINGS } from "../types/settings";
