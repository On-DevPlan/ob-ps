import { describe, it, expect } from "vitest";
import { collectRows, type CollectorSource } from "./link-collector";

describe("collectRows", () => {
  it("按 unresolvedTargets 分类，文件按 ctime 降序", () => {
    const src: CollectorSource = {
      listFiles: () => [
        { path: "a.md", ctime: 100 },
        { path: "b.md", ctime: 200 },
      ],
      getLinks: (p) =>
        p === "a.md"
          ? [{ link: "存在" }, { link: "不存在" }]
          : [{ link: "foo" }],
      unresolvedTargets: (p) =>
        p === "a.md" ? new Set(["不存在"]) : new Set(["foo"]),
    };
    const rows = collectRows(src);
    expect(rows).toEqual([
      {
        sourcePath: "b.md",
        sourceCtime: 200,
        target: "foo",
        state: "unresolved",
        position: undefined,
      },
      {
        sourcePath: "a.md",
        sourceCtime: 100,
        target: "存在",
        state: "resolved",
        position: undefined,
      },
      {
        sourcePath: "a.md",
        sourceCtime: 100,
        target: "不存在",
        state: "unresolved",
        position: undefined,
      },
    ]);
  });

  it("跳过 getLinks 返回 null 的文件", () => {
    const src: CollectorSource = {
      listFiles: () => [{ path: "a.md", ctime: 1 }],
      getLinks: () => null,
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)).toEqual([]);
  });

  it("保留 entry 的 position", () => {
    const src: CollectorSource = {
      listFiles: () => [{ path: "a.md", ctime: 1 }],
      getLinks: () => [{ link: "x", position: { line: 5, col: 3 } }],
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)[0]?.position).toEqual({ line: 5, col: 3 });
  });

  it("空 vault 返回空数组", () => {
    const src: CollectorSource = {
      listFiles: () => [],
      getLinks: () => [],
      unresolvedTargets: () => new Set(),
    };
    expect(collectRows(src)).toEqual([]);
  });
});
