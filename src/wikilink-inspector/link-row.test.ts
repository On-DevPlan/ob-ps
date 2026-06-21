import { describe, it, expect } from "vitest";
import {
  sortRowsByCtimeDesc,
  partitionByState,
  type LinkRow,
} from "./link-row";

function row(
  sourcePath: string,
  sourceCtime: number,
  state: LinkRow["state"] = "resolved",
): LinkRow {
  return { sourcePath, sourceCtime, target: "x", state };
}

describe("sortRowsByCtimeDesc", () => {
  it("按 sourceCtime 降序", () => {
    const rows = [row("a.md", 100), row("b.md", 300), row("c.md", 200)];
    expect(sortRowsByCtimeDesc(rows).map((r) => r.sourcePath)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  it("不修改入参数组", () => {
    const rows = [row("a.md", 100), row("b.md", 300)];
    sortRowsByCtimeDesc(rows);
    expect(rows.map((r) => r.sourceCtime)).toEqual([100, 300]);
  });

  it("空数组返回空数组", () => {
    expect(sortRowsByCtimeDesc([])).toEqual([]);
  });
});

describe("partitionByState", () => {
  it("拆分 resolved/unresolved 且保持原顺序", () => {
    const rows = [
      row("a", 1, "resolved"),
      row("b", 2, "unresolved"),
      row("c", 3, "resolved"),
    ];
    const { resolved, unresolved } = partitionByState(rows);
    expect(resolved.map((r) => r.sourcePath)).toEqual(["a", "c"]);
    expect(unresolved.map((r) => r.sourcePath)).toEqual(["b"]);
  });
});
