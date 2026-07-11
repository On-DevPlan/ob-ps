import { PluginSettingTab } from "obsidian";
import type { PluginSettings } from "../types/settings";
import * as sectionSkills from "./section-skills";
import * as sectionWikilink from "./section-wikilink";
import * as sectionKeepData from "./section-keep-data";
import * as sectionResolvedRecent from "./section-resolved-recent";
import * as sectionCommandGroups from "./section-command-groups";
import * as sectionLinkTree from "./section-link-tree";
import {
  TAB_LABEL,
  TAB_ORDER,
  normalizeActiveTab,
  type SettingsTabId,
} from "./tabs";

/**
 * 设置标签页需要的宿主能力最小集。
 *
 * 实际实现就是 `LocalRunnerPlugin` 本身 —— 它已经把 settings / saveSettings
 * / getDefaultCwd / applyWikilinkStyle 暴露为公开成员。
 *
 * 为什么不让 `LocalRunnerSettingTab` 接受一个 plain object 假装是 Plugin?
 * Obsidian 1.13+ 的 `PluginSettingTab.getControlValue` 默认实现会读
 * `this.plugin.settings`,父类在 `SettingTab` 注册时也会读 `plugin.manifest.id`。
 * 如果传非 `Plugin` 实例,运行时立刻报 "Cannot read properties of undefined"。
 * 因此本类坚持接收真实 `Plugin` 实例,再用 `as unknown as SettingTabHost` 转换。
 */
export interface SettingTabHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  getDefaultCwd(): string;
  // Kept because sectionWikilink.render still consumes it via the host bag.
  applyWikilinkStyle(): void;
  /** 命令组变更后通知侧边栏视图(可选,缺失则只持久化不热更新) */
  notifyCommandGroupsChanged?: () => void;
  /** 「最新已解析双链」条数变更后通知侧边栏视图重渲(可选) */
  notifyResolvedLimitChanged?: () => void;
  /** linkTree 事件分组统计(section-link-tree 用) */
  listLinkTreeTopics?(): Array<{ topicRoot: string | undefined; count: number; latestScan: number }>;
  /** 删除指定 topicRoot 的 linkTree 事件 */
  removeLinkTreeTopic?(topicRoot: string | undefined): Promise<number>;
  /** 清空全部 linkTree 事件 */
  clearAllLinkTreeEvents?(): Promise<number>;
}

/**
 * tab 切换防抖窗口 —— 500ms。
 * 切 tab 是高频动作;每次 saveSettings() 会触发 writeDataBackup()(vault 内 IO)。
 * 防抖避免连续切 tab 时重复落盘。
 */
const TAB_PERSIST_DEBOUNCE_MS = 500;

/**
 * 模块级防抖 timer 单例。
 * 全局唯一:任意切 tab 共享同一 timer,后到的 reset 前一个。
 */
let _persistTimer: number | null = null;

/**
 * Local Runner 设置标签页 —— 各 section 模块的组合根。
 *
 * 显示布局:
 *   ┌─────────────────────────────────────┐
 *   │ tab bar: [进程命令] [双链] [skill]   │
 *   ├─────────────────────────────────────┤
 *   │ 当前 tab 的 pane(2-3 个 section)      │
 *   └─────────────────────────────────────┘
 */
export class LocalRunnerSettingTab extends PluginSettingTab {
  /** 缓存 host 引用,避免每次 cast(plugin) */
  private readonly host: SettingTabHost;

  constructor(app: import("obsidian").App, plugin: import("obsidian").Plugin & SettingTabHost) {
    super(app, plugin);
    this.host = (this as unknown as { plugin: SettingTabHost }).plugin;
  }

  /**
   * 父类 `PluginSettingTab.display()` 在 Obsidian 1.13+ 被标记为 deprecated,
   * 但作为抽象方法必须实现;Obsidian 在设置页打开时会自动调用它。
   * 此处实现仅做容器清空 + 渲染委派,内部不调用任何 deprecated 方法,
   * 因此无需 `eslint-disable`。
   */
  display(): void {
    this.containerEl.empty();
    this.renderSettings();
  }

  /** 渲染 tab bar + 当前选中 tab 的 pane。 */
  private renderSettings(): void {
    this.renderTabBar();
    this.renderActivePane();
  }

  // ---- Tab bar --------------------------------------------------------------

  /**
   * 渲染顶部 tab bar —— 3 个 .lr-tab-btn 按钮。
   * active tab 加 is-active class。
   * 数据驱动:从 TAB_ORDER 顺序遍历。
   */
  private renderTabBar(): void {
    const bar = this.containerEl.createDiv({ cls: "lr-tab-bar" });
    bar.setAttr("role", "tablist");
    const active = normalizeActiveTab(this.host.settings.settingsActiveTab);
    for (const id of TAB_ORDER) {
      const btn = bar.createEl("button", {
        cls: `lr-tab-btn${id === active ? " is-active" : ""}`,
        attr: { type: "button", "data-tab": id, role: "tab" },
      });
      btn.setText(TAB_LABEL[id]);
      btn.addEventListener("click", () => this.onTabClick(id));
    }
  }

  /**
   * tab 按钮点击处理:
   * 1. 内存立即更新 settings.settingsActiveTab(无 IO)
   * 2. refreshDisplay() 重渲
   * 3. schedulePersistActiveTab() 防抖 500ms 后 saveSettings()
   */
  private onTabClick(id: SettingsTabId): void {
    if (this.host.settings.settingsActiveTab === id) return;
    this.host.settings.settingsActiveTab = id;
    this.refreshDisplay();
    this.schedulePersistActiveTab();
  }

  /**
   * 防抖 flush settings.settingsActiveTab。
   * 500ms 内的多次点击合并为一次 saveSettings。
   * 若已存在 timer,先清掉 —— 保证只有最后一次 flush。
   */
  private schedulePersistActiveTab(): void {
    if (_persistTimer !== null) window.clearTimeout(_persistTimer);
    _persistTimer = window.setTimeout(() => {
      _persistTimer = null;
      this.host.saveSettings().catch((err) => {
        // 防抖回调里 catch,不让 UI 看到 rejected promise;
        // 下次切 tab 会自然再 schedule 一次。
        console.warn("[local-runner] persist active tab failed:", err);
      });
    }, TAB_PERSIST_DEBOUNCE_MS);
  }

  // ---- Pane 路由 ------------------------------------------------------------

  /**
   * 根据 settings.settingsActiveTab 路由到对应 pane。
   * 路由前先 normalize —— 非法值兜底为 DEFAULT_TAB,
   * 且若磁盘值与 normalize 结果不一致,直接写回 settings(纠正污染数据)。
   */
  private renderActivePane(): void {
    const raw = this.host.settings.settingsActiveTab;
    const normalized = normalizeActiveTab(raw);
    if (raw !== normalized) {
      this.host.settings.settingsActiveTab = normalized;
      // 不在 render 路径里 saveSettings —— 已在 onTabClick 防抖路径覆盖。
      // 兜底纠正只更新内存;下次任意一次 saveSettings() 都会带上新值。
    }
    switch (normalized) {
      case "proc":
        this.renderProcPane();
        return;
      case "wl":
        this.renderWlPane();
        return;
      case "skill":
        this.renderSkillPane();
        return;
      default: {
        // 走不到这里 —— normalizeActiveTab 已穷尽所有 SettingsTabId。
        // 防御性兜底,渲染默认 tab。
        const _: never = normalized;
        void _;
        this.renderProcPane();
        return;
      }
    }
  }

  /** 进程命令 tab —— keep-data + command-groups */
  private renderProcPane(): void {
    const settings: PluginSettings = this.host.settings;
    sectionKeepData.render(this.containerEl, {
      settings,
      saveSettings: () => this.host.saveSettings(),
    });
    sectionCommandGroups.render(this.containerEl, {
      settings: { commandGroups: settings.commandGroups },
      saveSettings: () => this.host.saveSettings(),
      refreshSettings: () => this.refreshDisplay(),
      notifyCommandGroupsChanged: () => this.host.notifyCommandGroupsChanged?.(),
    });
  }

  /** 双链 tab —— wikilink 高亮颜色 + 清除说明 + resolvedRecent 数量 + linkTree 数据管理 */
  private renderWlPane(): void {
    const settings: PluginSettings = this.host.settings;
    sectionWikilink.render(this.containerEl, {
      settings,
      saveSettings: () => this.host.saveSettings(),
      applyWikilinkStyle: () => this.host.applyWikilinkStyle(),
    });
    sectionResolvedRecent.render(this.containerEl, {
      settings,
      saveSettings: () => this.host.saveSettings(),
      notifyResolvedLimitChanged: () => this.host.notifyResolvedLimitChanged?.(),
    });
    if (this.host.listLinkTreeTopics) {
      sectionLinkTree.render(this.containerEl, {
        listLinkTreeTopics: () => this.host.listLinkTreeTopics!(),
        removeLinkTreeTopic: (t) => this.host.removeLinkTreeTopic!(t),
        clearAllLinkTreeEvents: () => this.host.clearAllLinkTreeEvents!(),
        notifyResolvedLimitChanged: () => this.host.notifyResolvedLimitChanged?.(),
        refreshSettings: () => this.refreshDisplay(),
      });
    }
  }

  /** skill tab —— 安装 + 已装列表 */
  private renderSkillPane(): void {
    const settings: PluginSettings = this.host.settings;
    sectionSkills.render(this.containerEl, {
      settings,
      saveSettings: () => this.host.saveSettings(),
      getDefaultCwd: () => this.host.getDefaultCwd(),
    });
  }

  // ---- Display refresh ------------------------------------------------------

  /**
   * 刷新设置 UI:清空容器并重新渲染。
   * 不调用父类 deprecated 的 display(),而是直接清空 + 调 renderSettings(),
   * 二者等价,且避开 `no-deprecated` 规则。
   */
  private refreshDisplay(): void {
    this.containerEl.empty();
    this.renderSettings();
  }
}

// ---- 模块导出 --------------------------------------------------------------

// 头部保留 setHeading("设置") 行为(不变) — 由 section index 之外的显示需求决定;
// 当前设计 tab bar 已经表达主标题含义,不需要额外的 H1。
// 此注释仅为记录决策,不影响代码。

// ---- legacy 兼容 -----------------------------------------------------------
// 旧 import { LocalRunnerSettingTab } from "../settings-tab" 仍走此路径。
// 若调用方需要 SettingTabHost 类型,显式 import 本文件。