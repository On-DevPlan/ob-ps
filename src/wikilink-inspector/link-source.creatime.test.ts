import { describe, it, expect } from "vitest";
import { collectRows } from "./link-collector";
import { makeSource, makeNewFilesSource } from "./link-source";

// ---------------------------------------------------------------------------
// fake App 构造
// ---------------------------------------------------------------------------
interface FakeFile {
  path: string;
  mtime: number;
  ctime?: number;
  frontmatter?: { creatime?: unknown };
}

/** 构造最小 fake App:makeSource 只用到 vault.getMarkdownFiles + metadataCache.getFileCache */
function makeFakeApp(files: FakeFile[]) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((f) => ({
          path: f.path,
          stat: { mtime: f.mtime, ctime: f.ctime ?? f.mtime },
        })),
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const f = byPath.get(file.path);
        if (!f) return null;
        return {
          frontmatter: f.frontmatter ?? null,
          links: [{ link: "x" }],
          frontmatterLinks: [],
        };
      },
      unresolvedLinks: {},
    },
  };
}

// ---------------------------------------------------------------------------
// makeSource().listFiles() — 用文件系统 ctime 作排序键
// ---------------------------------------------------------------------------
describe("makeSource.listFiles — ctime 排序键", () => {
  it("返回文件系统 ctime", () => {
    const app = makeFakeApp([
      { path: "a.md", mtime: 1, ctime: 100 },
      { path: "b.md", mtime: 2, ctime: 200 },
    ]);
    const rows = makeSource(app as never).listFiles();
    expect(rows).toEqual([
      { path: "a.md", mtime: 100 },
      { path: "b.md", mtime: 200 },
    ]);
  });
});

describe("makeNewFilesSource.listFiles — 透传 ctime", () => {
  it("返回文件系统 ctime", () => {
    const app = makeFakeApp([
      { path: "a.md", mtime: 1, ctime: 100 },
      { path: "b.md", mtime: 2, ctime: 200 },
    ]);
    const files = makeNewFilesSource(app as never).listFiles();
    expect(files).toEqual([
      { path: "a.md", ctime: 100 },
      { path: "b.md", ctime: 200 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// collectRows(makeSource(app)) — 端到端:按 ctime 降序
// ---------------------------------------------------------------------------
describe("collectRows 端到端 — 按 ctime 排序", () => {
  it("ctime 新的在前", () => {
    const app = makeFakeApp([
      { path: "new.md", mtime: 100, ctime: 300 },
      { path: "old.md", mtime: 200, ctime: 100 },
    ]);
    const rows = collectRows(makeSource(app as never));
    expect(rows.map((r) => r.sourcePath)).toEqual(["new.md", "old.md"]);
  });

  it("同 ctime 保持稳定顺序", () => {
    const app = makeFakeApp([
      { path: "a.md", mtime: 1, ctime: 100 },
      { path: "b.md", mtime: 2, ctime: 100 },
    ]);
    const rows = collectRows(makeSource(app as never));
    expect(rows.map((r) => r.sourcePath)).toEqual(["a.md", "b.md"]);
  });
});
