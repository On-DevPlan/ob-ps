/**
 * link-source.ts — 把 Obsidian App 折叠成 CollectorSource
 *
 * 从 merged-view 抽出,便于 link-tree/snapshot-hook 等非 view 模块复用,
 * 避免反向依赖 view 层(会导致测试时加载 ItemView 类)。
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { CollectorSource, RawLinkEntry } from "./link-collector";
import type { NewFilesSource } from "./new-files";

/**
 * 解析 frontmatter `creatime` 为毫秒时间戳。
 * 仓库统一格式:`YYYY-MM-DD HH:mm:ss`(本地时间,无时区后缀)。
 * 模板占位符 `${now}`、其它格式、非法输入 → 返回 null(调用方按"缺失"处理)。
 */
export function parseCreatime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [, yy, mm, dd, hh, mi, ss] = m;
  const date = new Date(
    Number(yy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  // 本地时区构造不会产生 NaN,但越界会 rollover —— 校验各字段回读一致。
  if (
    date.getFullYear() !== Number(yy) ||
    date.getMonth() !== Number(mm) - 1 ||
    date.getDate() !== Number(dd) ||
    date.getHours() !== Number(hh) ||
    date.getMinutes() !== Number(mi) ||
    date.getSeconds() !== Number(ss)
  ) {
    return null;
  }
  return date.getTime();
}

/** 从 frontmatter 读 creatime;缺失/无效返回 null */
function readCreatime(app: App, file: unknown): number | null {
  const cache = app.metadataCache.getFileCache(file as never);
  return cache?.frontmatter ? parseCreatime(cache.frontmatter["creatime"]) : null;
}

/** 适配「新建文件」列表:每个文件 → path + creatime(缺失 → null) */
export function makeNewFilesSource(app: App): NewFilesSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        creatime: readCreatime(app, f),
      }));
    },
  };
}

export function makeSource(app: App): CollectorSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        // 排序键:mtime 字段承载 creatime(解析成功);缺失/无效 → -Infinity,
        // collectRows 的 b.mtime - a.mtime 降序会把它排在最后(严格排最后)。
        mtime: readCreatime(app, f) ?? Number.NEGATIVE_INFINITY,
      }));
    },
    getLinks(path) {
      const file = app.vault.getAbstractFileByPath(path);
      // duck typing 判 TFile(vitest mock 环境下 TFile 可能是 undefined;
      // 真实环境下 instanceof 更准;两个条件都过才认)
      if (!file) return null;
      if (TFile && !(file instanceof TFile)) return null;
      const cache = app.metadataCache.getFileCache(file as never);
      if (!cache) return null;
      const entries: RawLinkEntry[] = [];
      for (const l of cache.links ?? []) {
        entries.push({
          link: l.link,
          position: l.position
            ? { line: l.position.start.line, col: l.position.start.col }
            : undefined,
        });
      }
      for (const l of cache.frontmatterLinks ?? []) {
        entries.push({ link: l.link });
      }
      return entries;
    },
    unresolvedTargets(path) {
      const map = app.metadataCache.unresolvedLinks[path] ?? {};
      return new Set(Object.keys(map));
    },
  };
}
