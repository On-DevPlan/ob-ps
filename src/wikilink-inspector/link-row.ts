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
  /** 在源笔记中的位置，点击跳转用；frontmatter 链接无该字段 */
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
