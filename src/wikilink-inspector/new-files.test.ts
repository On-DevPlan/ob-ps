import { describe, it, expect } from "vitest";
import {
  collectNewFiles,
  sortNewFilesByCtime,
  type NewFileEntry,
  type NewFilesSource,
} from "./new-files";

describe("sortNewFilesByCtime", () => {
  it("按 ctime 降序", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", ctime: 100 },
      { path: "b.md", ctime: 300 },
      { path: "c.md", ctime: 200 },
    ];
    expect(sortNewFilesByCtime(files).map((f) => f.path)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  it("同 ctime 保持原顺序(稳定)", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", ctime: 100 },
      { path: "b.md", ctime: 100 },
    ];
    expect(sortNewFilesByCtime(files).map((f) => f.path)).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("不修改入参数组", () => {
    const files: NewFileEntry[] = [
      { path: "a.md", ctime: 100 },
      { path: "b.md", ctime: 200 },
    ];
    sortNewFilesByCtime(files);
    expect(files.map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("collectNewFiles", () => {
  it("返回所有文件,ctime 从 source 透传并按 ctime 降序", () => {
    const src: NewFilesSource = {
      listFiles: () => [
        { path: "a.md", ctime: 100 },
        { path: "b.md", ctime: 200 },
      ],
    };
    expect(collectNewFiles(src)).toEqual([
      { path: "b.md", ctime: 200 },
      { path: "a.md", ctime: 100 },
    ]);
  });

  it("空输入返回空数组", () => {
    const src: NewFilesSource = { listFiles: () => [] };
    expect(collectNewFiles(src)).toEqual([]);
  });
});
