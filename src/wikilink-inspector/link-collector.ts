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
