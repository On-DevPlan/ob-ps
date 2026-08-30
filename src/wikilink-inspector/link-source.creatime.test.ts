import { describe, it, expect } from "vitest";
import { collectRows } from "./link-collector";
import { makeSource, makeNewFilesSource, parseCreatime } from "./link-source";

// ---------------------------------------------------------------------------
// parseCreatime — 纯函数:frontmatter creatime 字符串 → 毫秒时间戳
// ---------------------------------------------------------------------------
describe("parseCreatime", () => {
  it("解析 YYYY-MM-DD HH:mm:ss 为毫秒时间戳", () => {
    expect(parseCreatime("2026-06-17 17:13:25")).toBe(
      new Date(2026, 5, 17, 17, 13, 25).getTime(),
    );
  });

  it("解析无效字符串返回 null", () => {
    expect(parseCreatime("not-a-date")).toBeNull();
    expect(parseCreatime("")).toBeNull();
  });

  it("模板占位符 ${now} 返回 null", () => {
    expect(parseCreatime("${now}")).toBeNull();
  });

  it("无效日期(越界)返回 null", () => {
    expect(parseCreatime("2026-13-45 99:99:99")).toBeNull();
  });

  it("非字符串输入返回 null", () => {
    expect(parseCreatime(undefined)).toBeNull();
    expect(parseCreatime(123)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeSource().listFiles() — 把 creatime 折进 mtime 排序键
// ---------------------------------------------------------------------------
interface FakeFile {
  path: string;
  mtime: number;
  frontmatter?: { creatime?: unknown };
}

/** 构造最小 fake App:makeSource 只用到 vault.getMarkdownFiles + metadataCache.getFileCache */
function makeFakeApp(files: FakeFile[]) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((f) => ({ path: f.path, stat: { mtime: f.mtime } })),
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

describe("makeSource.listFiles — creatime 排序键", () => {
  it("返回 creatime 解析后的毫秒时间戳", () => {
    const app = makeFakeApp([
      {
        path: "a.md",
        mtime: 1,
        frontmatter: { creatime: "2026-06-17 17:13:25" },
      },
    ]);
    const rows = makeSource(app as never).listFiles();
    expect(rows[0].mtime).toBe(new Date(2026, 5, 17, 17, 13, 25).getTime());
  });

  it("缺失/无效 creatime 返回 -Infinity(排最后)", () => {
    const app = makeFakeApp([
      { path: "no-fm.md", mtime: 1 }, // 无 frontmatter
      { path: "no-creatime.md", mtime: 1, frontmatter: {} }, // 有 frontmatter 无字段
      { path: "bad.md", mtime: 1, frontmatter: { creatime: "${now}" } }, // 占位符
    ]);
    const rows = makeSource(app as never).listFiles();
    for (const r of rows) expect(r.mtime).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("makeNewFilesSource.listFiles — 透传 creatime", () => {
  it("有 creatime 返回解析值,缺失返回 null", () => {
    const app = makeFakeApp([
      {
        path: "a.md",
        mtime: 1,
        frontmatter: { creatime: "2026-06-17 17:13:25" },
      },
      { path: "no-creatime.md", mtime: 2 },
    ]);
    const files = makeNewFilesSource(app as never).listFiles();
    expect(files).toEqual([
      { path: "a.md", creatime: new Date(2026, 5, 17, 17, 13, 25).getTime() },
      { path: "no-creatime.md", creatime: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// collectRows(makeSource(app)) — 端到端:按 creatime 降序,缺失排最后
// ---------------------------------------------------------------------------
describe("collectRows 端到端 — 按 creatime 排序", () => {
  it("creatime 新的在前,缺失的排最后", () => {
    const app = makeFakeApp([
      { path: "no-creatime.md", mtime: 999 }, // 无 creatime,但 mtime 最大
      {
        path: "new.md",
        mtime: 100,
        frontmatter: { creatime: "2026-08-01 10:00:00" },
      },
      {
        path: "old.md",
        mtime: 200,
        frontmatter: { creatime: "2026-06-01 10:00:00" },
      },
    ]);
    const src = makeSource(app as never);
    const rows = collectRows(src);
    expect(rows.map((r) => r.sourcePath)).toEqual([
      "new.md", // creatime 最新
      "old.md", // creatime 较早
      "no-creatime.md", // 缺失 → 最后(即使 mtime 最大)
    ]);
  });

  it("同 creatime 保持稳定顺序", () => {
    const app = makeFakeApp([
      {
        path: "a.md",
        mtime: 1,
        frontmatter: { creatime: "2026-07-01 00:00:00" },
      },
      {
        path: "b.md",
        mtime: 2,
        frontmatter: { creatime: "2026-07-01 00:00:00" },
      },
    ]);
    const rows = collectRows(makeSource(app as never));
    expect(rows.map((r) => r.sourcePath)).toEqual(["a.md", "b.md"]);
  });
});
