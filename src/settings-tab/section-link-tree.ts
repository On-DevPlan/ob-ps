/**
 * section-link-tree.ts — 设置页"双链树数据"section
 *
 * 用户从此处:
 * 1. 查看 linkTree 事件按 topicRoot 分组的统计
 * 2. 删除某个主题的所有事件
 * 3. 清空所有 linkTree 数据
 */
import { Notice, Setting } from "obsidian";
import type LocalRunnerPlugin from "../../main";

export interface LinkTreeSectionHost {
  /** 列出 linkTree topic 分组 (LocalRunnerPlugin.listLinkTreeTopics) */
  listLinkTreeTopics(): Array<{ topicRoot: string | undefined; count: number; latestScan: number }>;
  /** 删除指定 topicRoot 的事件 (LocalRunnerPlugin.removeLinkTreeTopic) */
  removeLinkTreeTopic(topicRoot: string | undefined): Promise<number>;
  /** 清空所有 linkTree 事件 (LocalRunnerPlugin.clearAllLinkTreeEvents) */
  clearAllLinkTreeEvents(): Promise<number>;
  /** 触发 merged-view 刷新 */
  notifyResolvedLimitChanged?(): void;
  /** 重新渲染设置页(删除后列表更新) */
  refreshSettings(): void;
}

/** 渲染"双链树数据"section —— 默认折叠,避免在大数据时占太多设置页空间 */
export function render(containerEl: HTMLElement, host: LinkTreeSectionHost): void {
  // 用 <details> 实现默认折叠。用户展开后才看到统计和删除按钮。
  const details = containerEl.createEl("details", { cls: "lr-linktree-details" });
  const summary = details.createEl("summary", { cls: "lr-linktree-summary" });
  summary.setText("双链树数据管理");

  // 折叠时在 summary 显示统计概览(避免打开才能看到)
  const topics = host.listLinkTreeTopics();
  const total = topics.reduce((sum, t) => sum + t.count, 0);
  const legacyCount = topics.find((t) => t.topicRoot === undefined)?.count ?? 0;
  summary.createEl("span", {
    cls: "lr-linktree-summary-stat",
    text: total > 0
      ? `${total} 条事件 · ${topics.length} 个主题${legacyCount > 0 ? ` · legacy ${legacyCount}` : ""}`
      : "无数据",
  });

  // 可折叠的内容区
  const body = details.createDiv({ cls: "lr-linktree-body" });

  // 总览
  const overview = body.createDiv({ cls: "lr-linktree-overview" });
  overview.createEl("p", {
    text: `当前共 ${total} 条事件,分布在 ${topics.length} 个主题中。`,
  });
  if (legacyCount > 0) {
    overview.createEl("p", {
      text: `其中 ${legacyCount} 条为旧版 snapshot 残留数据(topicRoot 为空),建议清理。`,
      attr: { style: "color: var(--text-warning);" },
    });
  }

  // 按主题列出
  if (topics.length > 0) {
    new Setting(body)
      .setName("各主题事件数")
      .setDesc("点击右侧按钮删除某个主题的所有事件");

    for (const t of topics) {
      const label = t.topicRoot ?? "(legacy — 无 topicRoot)";
      const date = new Date(t.latestScan);
      const dateStr = isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 16).replace("T", " ");

      new Setting(body)
        .setName(label)
        .setDesc(`${t.count} 条事件 · 最近扫描: ${dateStr}`)
        .addButton((b) => {
          b.setIcon("trash")
            .setTooltip(`删除主题「${label}」的所有事件`)
            .setButtonText("删除")
            .onClick(async () => {
              // legacy 主题(topicRoot=undefined)传 undefined,不要传 ""
              const removed = await host.removeLinkTreeTopic(t.topicRoot);
              new Notice(`已删除 ${removed} 条事件`);
              if (host.notifyResolvedLimitChanged) host.notifyResolvedLimitChanged();
              host.refreshSettings();
            });
        });
    }
  }

  // 清空所有
  if (total > 0) {
    new Setting(body)
      .setName("清空所有双链树数据")
      .setDesc("删除全部 linkTree 事件(包括所有主题 + legacy 残留)。此操作不可撤销。")
      .addButton((b) => {
        b.setIcon("trash-2")
          .setButtonText("清空")
          .setWarning()
          .onClick(async () => {
            const removed = await host.clearAllLinkTreeEvents();
            new Notice(`已清空 ${removed} 条事件`);
            if (host.notifyResolvedLimitChanged) host.notifyResolvedLimitChanged();
            host.refreshSettings();
          });
      });
  }
}

/** 适配器:把 LocalRunnerPlugin 的方法映射到 LinkTreeSectionHost */
export function hostFromPlugin(plugin: LocalRunnerPlugin, refreshSettings: () => void): LinkTreeSectionHost {
  return {
    listLinkTreeTopics: () => plugin.listLinkTreeTopics(),
    removeLinkTreeTopic: (topicRoot) => plugin.removeLinkTreeTopic(topicRoot),
    clearAllLinkTreeEvents: () => plugin.clearAllLinkTreeEvents(),
    notifyResolvedLimitChanged: () => plugin.notifyResolvedLimitChanged(),
    refreshSettings,
  };
}