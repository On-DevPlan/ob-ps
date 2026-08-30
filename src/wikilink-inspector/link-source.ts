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

/** 适配「新建文件」列表:每个文件 → path + 文件系统创建时间(ctime) */
export function makeNewFilesSource(app: App): NewFilesSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        ctime: f.stat.ctime,
      }));
    },
  };
}

export function makeSource(app: App): CollectorSource {
  return {
    listFiles() {
      return app.vault.getMarkdownFiles().map((f) => ({
        path: f.path,
        // 排序键/展示时间:统一用文件系统创建时间(ctime),不再解析 frontmatter。
        mtime: f.stat.ctime,
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
