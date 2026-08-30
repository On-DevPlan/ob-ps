/**
 * new-files.ts — 「新建文件」列表
 *
 * 直接列出按 creatime 排序的新建文件本身(不再按链接拆行展示 target)。
 * 语义:用户新建笔记时,列表顶部显示该笔记(文件),而非它引用的旧笔记。
 */

/** 一个新建文件条目 */
export interface NewFileEntry {
  /** vault 相对路径 */
  path: string;
  /** 文件创建时间(frontmatter creatime 解析值,ms);缺失/无效 → null(排最后) */
  creatime: number | null;
}

/** 收集器依赖的最小接口 —— UI 层把 app 适配成此接口 */
export interface NewFilesSource {
  /** 所有 markdown 文件(路径 + creatime) */
  listFiles(): { path: string; creatime: number | null }[];
}

/**
 * 按 creatime 降序返回新数组,缺失(null)排最后,不改入参。
 * 有值者按值降序;null 沉底且保持原相对顺序(稳定)。
 */
export function sortNewFilesByCreatime(files: NewFileEntry[]): NewFileEntry[] {
  return [...files].sort((a, b) => {
    // 缺失(null)恒排在有效值之后
    if (a.creatime === null && b.creatime === null) return 0;
    if (a.creatime === null) return 1;
    if (b.creatime === null) return -1;
    return b.creatime - a.creatime;
  });
}

/** 从 source 收集全部新建文件,按 creatime 降序,缺失排最后。 */
export function collectNewFiles(source: NewFilesSource): NewFileEntry[] {
  return sortNewFilesByCreatime(
    source.listFiles().map((f) => ({
      path: f.path,
      creatime: f.creatime,
    })),
  );
}
