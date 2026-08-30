import type { LinkRow } from "./link-row";

/**
 * 源笔记名（去 .md 后缀） */
function sourceBaseName(sourcePath: string): string {
  return sourcePath.replace(/\.md$/i, "");
}

/**
 * 创建时间显示：当年用 MM-DD HH:mm，跨年用 YYYY-MM-DD。
 * 用 Obsidian 注入的全局 moment。
 *
 * 命名沿用 formatCtime 是因为历史实现用 ctime(创建时间) —— 现统一用文件系统
 * 创建时间(ctime),函数名保留以最小化 churn。
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

  el.createSpan({ cls: "wli-time", text: formatCtime(row.sourceMtime) });

  el.setAttr("title", `${row.target}\n来自 ${row.sourcePath}`);
  el.addEventListener("click", () => onClick(row));

  return el;
}
