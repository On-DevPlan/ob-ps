import { describe, it, expect } from "vitest";
import {
  sortRowsByCtimeDesc,
  partitionByState,
  dedupeRowsByTarget,
  type LinkRow,
} from "./link-row";

function row(
  sourcePath: string,
  sourceCtime: number,
  state: LinkRow["state"] = "resolved",
): LinkRow {
  return { sourcePath, sourceCtime, target: "x", state };
}

function targetRow(
  target: string,
  sourcePath: string,
  sourceCtime: number,
): LinkRow {
  return { sourcePath, sourceCtime, target, state: "resolved" };
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

describe("dedupeRowsByTarget", () => {
  it("同目标只保留首次出现（配合 ctime 降序 = 保留最新）", () => {
    const rows = [
      targetRow("欢迎", "new.md", 300),
      targetRow("欢迎", "old.md", 100),
    ];
    const out = dedupeRowsByTarget(rows);
    expect(out).toHaveLength(1);
    expect(out[0].sourcePath).toBe("new.md");
  });

  it("A 与 A#锚点 折叠为一条", () => {
    const rows = [
      targetRow("目标", "a.md", 300),
      targetRow("目标#章节", "b.md", 200),
    ];
    expect(dedupeRowsByTarget(rows)).toHaveLength(1);
  });

  it("忽略目标首尾空白", () => {
    const rows = [
      targetRow(" 目标 ", "a.md", 300),
      targetRow("目标", "b.md", 200),
    ];
    expect(dedupeRowsByTarget(rows)).toHaveLength(1);
  });

  it("不同目标各自保留", () => {
    const rows = [
      targetRow("甲", "a.md", 300),
      targetRow("乙", "b.md", 200),
      targetRow("丙", "c.md", 100),
    ];
    expect(dedupeRowsByTarget(rows).map((r) => r.target)).toEqual([
      "甲",
      "乙",
      "丙",
    ]);
  });

  it("空数组返回空数组", () => {
    expect(dedupeRowsByTarget([])).toEqual([]);
  });

  it("不修改入参数组", () => {
    const rows = [targetRow("甲", "a.md", 300), targetRow("甲", "b.md", 100)];
    dedupeRowsByTarget(rows);
    expect(rows).toHaveLength(2);
  });
});
