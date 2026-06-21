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
    this.contentEl.empty();
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
    });
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
          void this.openSource(row);
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
