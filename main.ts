import { FileSystemAdapter, MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { ProcessConfig } from "./src/types/process";
import { DEFAULT_SETTINGS, type PluginSettings } from "./src/types/settings";
import { MERGED_VIEW_TYPE, MergedRunnerInspectorView, type MergedViewOptions } from "./src/view";
import {
  removeDataBackup,
  restoreDataBackup,
  writeDataBackup,
  type BackupPayload,
} from "./src/backup/data-backup";
import { LocalRunnerSettingTab } from "./src/settings-tab";
import { migrateCommandGroups } from "./src/settings-tab/migrate-command-groups";
import { applyWikilinkStyle } from "./src/wikilink/highlight";
import { reconcileInstalledFlag } from "./src/settings-tab/section-skills";
import { flattenWikilinks } from "./src/wikilink-inspector/flatten-links";
import { loadEvents, appendEvents } from "./src/link-tree/link-tree-repository";
import { scanActiveNoteTopic, removeEventsByTopicRoot } from "./src/link-tree/vault-scanner";
import { buildBklinkGraph, findTopicRoot } from "./src/link-tree/topic-resolver";
import type { CreationEvent } from "./src/link-tree/creation-event";

/** 编程方式跳转到设置标签页(内部 API) */
interface AppWithSetting {
  setting: { open(): Promise<void>; openTabById(id: string): void };
}

/** 持久化插件数据格式 */
interface PluginData {
  /** schema 版本(v2:加 schemaVersion + 删除 processes) */
  schemaVersion?: number;
  /** Legacy 兼容字段:仍用于恢复已保存的进程 tab 与卸载备份。 */
  processes?: ProcessConfig[];
  settings?: PluginSettings;
  linkTree?: { events: CreationEvent[]; version: number };
  /** linkTree 节点折叠状态:按 topicRoot 分组的节点 basename 数组 */
  linkTreeCollapsed?: Record<string, string[]>;
}

/** 当前 schema 版本。新加字段时递增,迁移逻辑判断 schemaVersion 走对应分支。*/
const CURRENT_SCHEMA_VERSION = 2;

/**
 * v1 → v2 迁移:
 * 1. 删除废弃的 `processes` 字段(snapshot 机制已删,数据不再用)
 * 2. 给 linkTree.events 中无 topicRoot 的 legacy 事件打标记(可由 UI 清理)
 * 3. 加 schemaVersion=2
 */
function migrateV1ToV2(data: PluginData): PluginData {
  const next: PluginData = {
    schemaVersion: 2,
    settings: data.settings,
    linkTree: data.linkTree
      ? {
          version: data.linkTree.version,
          events: data.linkTree.events,
        }
      : undefined,
  };
  // 故意删除 processes(不复制)
  return next;
}

/**
 * Local Runner —— Obsidian 侧边栏插件。
 * 在侧边栏中启动本地 shell 命令(如 `npm run dev`),并按进程分列实时输出。
 *
 * 仅桌面端可用:依赖 Node 的 `child_process`,移动端沙箱不提供该能力。
 *
 * 本文件只承担「插件入口编排」职责:
 *   - onload: 加载数据 + 注册视图/命令/设置页
 *   - 编排: 把分散能力(skills/backup/wikilink/settings-tab)拼接起来
 * 真正的实现已迁移到 src/{skills,backup,wikilink,settings-tab,view,runner}/。
 */
export default class LocalRunnerPlugin extends Plugin {
  /** 已保存的进程配置,view 构造时传入 */
  private savedConfigs: ProcessConfig[] = [];
  /** 设置 */
  settings: PluginSettings = DEFAULT_SETTINGS;
  /** 完善历史树事件日志 */
  private linkTreeEvents: CreationEvent[] = [];
  /**
   * 折叠状态:用户主动折叠的节点 basename 集合。
   * 按 topicRoot 分组(每个主题独立)持久化到 data.json。
   * 形状: { [topicRoot: string]: string[] }
   */
  private linkTreeCollapsed: Record<string, string[]> = {};

  async onload(): Promise<void> {
    console.debug("[DBG onload] local-runner plugin loaded, version=1.0.27-bklink-topic");

    // 1. 加载持久化数据
    let data = (await this.loadData()) as PluginData | null;

    // 1a. Schema 迁移:检测旧数据无 schemaVersion,做 v1→v2 升级
    //     (主要动作:删除 legacy `processes` 字段,标记 schemaVersion=2)
    if (data && !data.schemaVersion) {
      data = migrateV1ToV2(data);
      // 持久化迁移结果
      await this.saveData(data);
    }

    // 2. 主数据缺失(卸载/重装后)时,尝试从 vault 级备份恢复
    let restored = false;
    if (data === null) {
      const backup = this.tryRestoreBackup();
      if (backup) {
        data = { processes: backup.processes, settings: backup.settings, schemaVersion: 2 };
        restored = true;
      }
    }

    this.savedConfigs = data?.processes ?? [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
    this.linkTreeEvents = loadEvents(data ?? null);
    this.linkTreeCollapsed = data?.linkTreeCollapsed ?? {};

    // 3. 迁移 commandGroups:旧「一组多预设」→ 新「一组一命令」
    const rawGroups = this.settings.commandGroups;
    const migratedGroups = migrateCommandGroups(rawGroups);
    const migrated = !shallowEqualGroups(rawGroups, migratedGroups);
    this.settings.commandGroups = migratedGroups;
    if (migrated) {
      await this.saveSettings();
    }

    // 4. 恢复成功后立即写回主数据位置,使后续 loadData 命中
    if (restored) {
      await this.saveSettings();
      new Notice("✅ 已从备份恢复进程配置与设置");
    }

    // 5. 纠正「已安装」与磁盘状态不一致
    this.reconcileInstalledFlag();

    // 6. 应用高亮双链样式
    applyWikilinkStyle(this.settings);
    // Obsidian 切换主题时会翻转 body.theme-dark，fg vars 要重新注入
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        applyWikilinkStyle(this.settings);
      }),
    );

    // 7. 注册设置标签页
    this.addSettingTab(new LocalRunnerSettingTab(this.app, this));

    // 8. 注册合并视图
    this.registerView(MERGED_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      const view = new MergedRunnerInspectorView(leaf, this.buildMergedViewOptions());
      view.setTabsFromConfigs(this.savedConfigs);
      return view;
    });

    // 9. 功能区图标:点击打开侧边栏
    this.addRibbonIcon("play", "Local runner", () => {
      void this.activateView();
    });

    // 10. 命令面板入口
    this.addCommand({
      id: "open",
      name: "打开侧边栏",
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({
      id: "open-settings",
      name: "打开设置",
      callback: () => {
        void this.openSettings();
      },
    });
    this.addCommand({
      id: "clear-wikilinks",
      name: "将当前笔记的双链转为单链",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("请先打开一篇笔记");
          return;
        }
        const count = flattenWikilinks(view.editor);
        new Notice(`已将 ${count} 条双链转为单链`);
      },
    });
  }

  /** 打开插件设置页 */
  async openSettings(): Promise<void> {
    const app = this.app as unknown as AppWithSetting;
    await app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  /** 激活(或首次创建)侧边栏视图并置顶显示 */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: MERGED_VIEW_TYPE, active: true });
    }
    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }

  async saveSettings(): Promise<void> {
    // 持久化 linkTree 时：如果内存里没有事件但磁盘有，保留磁盘数据（防覆盖）
    let linkTreeStore: { events: CreationEvent[]; version: number } | undefined;
    if (this.linkTreeEvents.length > 0) {
      linkTreeStore = { events: this.linkTreeEvents, version: 1 };
    } else {
      const disk = (await this.loadData()) as PluginData | null;
      if (disk?.linkTree?.events?.length) {
        linkTreeStore = disk.linkTree;
        this.linkTreeEvents = disk.linkTree.events; // 同步回内存
      }
    }
    await this.saveData({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      processes: this.savedConfigs,  // v2 起该字段已废弃,持久化时不再写(但读时仍兼容)
      settings: this.settings,
      linkTree: linkTreeStore,
      linkTreeCollapsed: this.linkTreeCollapsed,
    });
    // 开启保留时同步刷新备份;关闭时清除已有备份
    // 注:备份链路暂不纳入 linkTree(对齐 joke 实际行为)
    const vault = this.getDefaultCwd();
    const configDir = this.app.vault.configDir;
    const payload: BackupPayload = {
      processes: this.savedConfigs,
      settings: this.settings,
    };
    if (this.settings.keepDataOnUninstall) {
      writeDataBackup(vault, configDir, payload);
    } else {
      removeDataBackup(vault, configDir);
    }
  }

  /** 取 vault 根目录作为命令的默认工作目录 */
  getDefaultCwd(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  }

  /**
   * 用户点击 tree scan 按钮时触发 vault 扫描。
   * 取代了之前的 onProcessStart snapshot 机制(Tasks 7-9 删除)。
   */
  async onTreeScanClicked(activeNotePath: string): Promise<void> {
    console.debug("[DBG onTreeScanClicked] enter, path=", activeNotePath);
    try {
      const result = await scanActiveNoteTopic(this.app, activeNotePath);
      const filtered = removeEventsByTopicRoot(this.linkTreeEvents, result.topicRoot);
      this.linkTreeEvents = appendEvents(filtered, result.events).events;
      await this.saveSettings();
      new Notice(`✅ 已生成 ${result.nodeCount} 节点的双链树`);
    } catch (e) {
      console.warn("[link-tree] scan failed", e);
      new Notice(`❌ 生成失败: ${(e as Error).message}`);
      throw e; // re-throw so caller (merged-view) can also catch
    }
  }

  /**
   * 删除指定 topicRoot 的所有 linkTree 事件(用于设置页 UI 清理某个主题)。
   * 不修改入参数组;返回新数组并同步回 this.linkTreeEvents + 持久化。
   * topicRoot 可以是 string(普通主题) 或 undefined(legacy 无 topicRoot 事件)。
   */
  async removeLinkTreeTopic(topicRoot: string | undefined): Promise<number> {
    const before = this.linkTreeEvents.length;
    this.linkTreeEvents = this.linkTreeEvents.filter(
      (e) => e.topicRoot !== topicRoot,
    );
    const removed = before - this.linkTreeEvents.length;
    if (removed > 0) await this.saveSettings();
    return removed;
  }

  /**
   * 清空所有 linkTree 事件(用于设置页"重置 linkTree 数据")。
   * 同时清掉 legacy 无 topicRoot 的旧 snapshot 事件。
   */
  async clearAllLinkTreeEvents(): Promise<number> {
    const before = this.linkTreeEvents.length;
    this.linkTreeEvents = [];
    if (before > 0) await this.saveSettings();
    return before;
  }

  /**
   * 列出 linkTree 按 topicRoot 分组的事件统计(用于设置页显示)。
   * 返回 [{ topicRoot: string | undefined, count: number, latestScan: number }]
   * latestScan = 该组内 firstSeenAt 最大的事件(粗略代表最近扫描时间)
   */
  listLinkTreeTopics(): Array<{ topicRoot: string | undefined; count: number; latestScan: number }> {
    const groups = new Map<string | undefined, { count: number; latestScan: number }>();
    for (const e of this.linkTreeEvents) {
      const key = e.topicRoot;
      const g = groups.get(key) ?? { count: 0, latestScan: 0 };
      g.count++;
      if (e.firstSeenAt > g.latestScan) g.latestScan = e.firstSeenAt;
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([topicRoot, g]) => ({ topicRoot, count: g.count, latestScan: g.latestScan }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 树节点折叠状态变化时由 view 回调:
   * 更新内存并写盘。debounce 由 view 控制(用户在画布上连续点折叠是高频操作)。
   */
  async setLinkTreeCollapsed(topicRoot: string, collapsed: string[]): Promise<void> {
    if (collapsed.length === 0) {
      delete this.linkTreeCollapsed[topicRoot];
    } else {
      this.linkTreeCollapsed[topicRoot] = collapsed;
    }
    await this.saveSettings();
  }

  /** 给 view 读取折叠状态(初始化时用) */
  getLinkTreeCollapsed(topicRoot: string): string[] {
    return this.linkTreeCollapsed[topicRoot] ?? [];
  }

  /** 获取 MergedView 实例 */
  private async getOrActivateMergedView(): Promise<MergedRunnerInspectorView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return null;
      await rightLeaf.setViewState({ type: MERGED_VIEW_TYPE, active: true });
      leaf = rightLeaf;
    }
    const view = leaf.view;
    return view instanceof MergedRunnerInspectorView ? view : null;
  }

  /** 设置 tab 改动 commandGroups 后调用:通知已打开的 merged-view 重建快速按钮栏。
   * 仅在 view 已存在时通知;避免因设置改动强行把侧边栏弹出来。
   */
  async notifyCommandGroupsChanged(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof MergedRunnerInspectorView) {
      view.notifyCommandGroupsChanged();
    }
  }

  /** 设置 tab 改动「最新已解析双链数量」后调用:通知已打开的 merged-view 重渲该区块。
   * 仅在 view 已存在时通知,不强行弹出侧边栏。
   */
  notifyResolvedLimitChanged(): void {
    const leaf = this.app.workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof MergedRunnerInspectorView) {
      view.notifyResolvedLimitChanged();
    }
  }

  /** linkTreeEvents 改动后通知已打开的 merged-view 重绘 Canvas;不主动打开侧边栏。 */
  notifyLinkTreeChanged(): void {
    try {
      const leaf = this.app.workspace.getLeavesOfType(MERGED_VIEW_TYPE)[0];
      const view = leaf?.view;
      if (view instanceof MergedRunnerInspectorView) {
        view.notifyLinkTreeChanged();
      }
    } catch (e) {
      console.warn("[link-tree] notify failed", e);
    }
  }

  /** 根据设置开关添加/移除高亮双链 body class */
  applyWikilinkStyle(): void {
    applyWikilinkStyle(this.settings);
  }

  // ---- 内部辅助 --------------------------------------------------------------

  /** 视图初始化参数 */
  private buildMergedViewOptions(): MergedViewOptions {
    // active topicRoot 决定给 view 传哪个主题的折叠状态
    const activePath = (() => {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      return md?.file?.path ?? null;
    })();
    const activeTopicRoot = this.findTopicRootFor(activePath);
    return {
      defaultCwd: this.getDefaultCwd(),
      settings: this.settings,
      onSaveConfigs: (configs) => {
        this.savedConfigs = configs;
        void this.saveSettings();
      },
      onSaveCommandGroups: (groups) => {
        this.settings.commandGroups = groups;
        void this.saveSettings();
      },
      getLinkTreeEvents: () => this.linkTreeEvents,
      onTreeScan: (activePath) => this.onTreeScanClicked(activePath),
      getCollapsed: () =>
        activeTopicRoot ? this.getLinkTreeCollapsed(activeTopicRoot) : [],
      onCollapsedChange: (topicRoot, collapsed) => {
        void this.setLinkTreeCollapsed(topicRoot, collapsed);
      },
      // 进程成功退出 + 启用 rescanOnExit 时,触发自动重新扫描
      onProcessExit: (tab) => this.handleProcessExit(tab),
    };
  }

  /**
   * 进程退出处理:
   * 1. 如果 tab.rescanOnExit && tab.status==exited-ok && tab.rescanTargetPath
   *    → 调 onTreeScanClicked 重新扫描启动时记录的活动笔记
   * 2. 通知 merged-view 树已更新
   */
  private async handleProcessExit(tab: { rescanOnExit?: boolean; rescanTargetPath?: string; status?: string }): Promise<void> {
    if (!tab.rescanOnExit || tab.status !== "exited-ok" || !tab.rescanTargetPath) {
      return;
    }
    try {
      const result = await scanActiveNoteTopic(this.app, tab.rescanTargetPath);
      const filtered = removeEventsByTopicRoot(this.linkTreeEvents, result.topicRoot);
      this.linkTreeEvents = appendEvents(filtered, result.events).events;
      await this.saveSettings();
      this.notifyLinkTreeChanged();
      new Notice(`✅ 进程退出后自动重新生成 ${result.nodeCount} 节点的双链树`);
    } catch (e) {
      console.warn("[rescanOnExit] scan failed", e);
      new Notice(`❌ 自动重新扫描失败: ${(e as Error).message}`);
    }
  }

  /** 根据 active 笔记路径算出 topicRoot(纯查表,不读 vault) */
  private findTopicRootFor(activePath: string | null): string | null {
    if (!activePath) return null;
    const basename = activePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    // 从已加载的事件找 topicRoot(避免重复构建 graph)
    const hit = this.linkTreeEvents.find(
      (e) => e.topicRoot && e.target === basename,
    );
    if (hit?.topicRoot) return hit.topicRoot;
    // fallback: 用 graph 算
    const graph = buildBklinkGraph(this.app);
    return findTopicRoot(basename, graph);
  }

  /** 尝试从 vault 级备份恢复 */
  private tryRestoreBackup(): BackupPayload | null {
    return restoreDataBackup(this.getDefaultCwd(), this.app.vault.configDir);
  }

  /** 同步「已安装」与磁盘状态:已安装但目录不存在时自动重置 */
  private reconcileInstalledFlag(): void {
    const vault = this.getDefaultCwd();
    const changed = reconcileInstalledFlag(this.settings, vault);
    if (changed) this.saveSettings().catch(() => {});
  }
}

/** 浅比较两组数组的元素是否一致(按当前形状逐字段比较) */
function shallowEqualGroups(
  a: unknown,
  b: import("./src/types/commands").CommandGroup[],
): boolean {
  if (!Array.isArray(a)) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>;
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.name !== y.name) return false;
    if (x.command !== y.command) return false;
    if ((x.cwd ?? "") !== (y.cwd ?? "")) return false;
  }
  return true;
}
