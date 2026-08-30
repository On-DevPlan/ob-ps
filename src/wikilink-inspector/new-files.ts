/**
 * new-files.ts — 「新建文件」列表
 *
 * 直接列出按文件系统创建时间(ctime)排序的新建文件本身(不再按链接拆行展示 target)。
 * 语义:用户新建笔记时,列表顶部显示该笔记(文件),而非它引用的旧笔记。
 */

/** 一个新建文件条目 */
export interface NewFileEntry {
  /** vault 相对路径 */
  path: string;
  /** 文件系统创建时间(TFile.stat.ctime,ms)——排序键 */
  ctime: number;
}

/** 收集器依赖的最小接口 —— UI 层把 app 适配成此接口 */
export interface NewFilesSource {
  /** 所有 markdown 文件(路径 + ctime) */
  listFiles(): { path: string; ctime: number }[];
}

/**
 * 按 ctime 降序返回新数组(最新创建置顶),不改入参。
 * 同 ctime 时保持原相对顺序(Array.prototype.sort 稳定)。
 */
export function sortNewFilesByCtime(files: NewFileEntry[]): NewFileEntry[] {
  return [...files].sort((a, b) => b.ctime - a.ctime);
}

/** 从 source 收集全部新建文件,按 ctime 降序。 */
export function collectNewFiles(source: NewFilesSource): NewFileEntry[] {
  return sortNewFilesByCtime(
    source.listFiles().map((f) => ({
      path: f.path,
      ctime: f.ctime,
    })),
  );
}
