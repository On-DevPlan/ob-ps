import { describe, it, expect } from "vitest";
import {
  collectNewFiles,
  sortNewFilesByCreatime,
  type NewFileEntry,
  type NewFilesSource,
} from "./new-files";

describe("sortNewFilesByCreatime", () => {
  it("按 creatime 降序", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", creatime: 100 },
      { path: "b.md", creatime: 300 },
      { path: "c.md", creatime: 200 },
    ];
    expect(sortNewFilesByCreatime(files).map((f) => f.path)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  it("缺失 creatime(null)排最后", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", creatime: 100 },
      { path: "none.md", creatime: null },
      { path: "b.md", creatime: 200 },
    ];
    expect(sortNewFilesByCreatime(files).map((f) => f.path)).toEqual([
      "b.md",
      "a.md",
      "none.md",
    ]);
  });

  it("全部缺失时保持原顺序(稳定)", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", creatime: null },
      { path: "b.md", creatime: null },
    ];
    expect(sortNewFilesByCreatime(files).map((f) => f.path)).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("不修改入参数组", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", creatime: 100 },
      { path: "b.md", creatime: 200 },
    ];
    sortNewFilesByCreatime(files);
    expect(files.map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("collectNewFiles", () => {
  it("返回所有文件,creatime 从 source 透传", () => {
    const src: NewFilesSource = {
      listFiles: () => [
        { path: "a.md", creatime: 100 },
        { path: "b.md", creatime: null },
      ],
    };
    expect(collectNewFiles(src)).toEqual([
      { path: "a.md", creatime: 100 },
      { path: "b.md", creatime: null },
    ]);
  });

  it("空输入返回空数组", () => {
    const src: NewFilesSource = { listFiles: () => [] };
    expect(collectNewFiles(src)).toEqual([]);
  });
});
