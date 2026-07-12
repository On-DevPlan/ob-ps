import { describe, it, expect } from "vitest";
import { migrateCommandGroups } from "./migrate-command-groups";

describe("migrateCommandGroups", () => {
  it("空数组返回空数组", () => {
    expect(migrateCommandGroups([])).toEqual([]);
  });

  it("新形状原样保留并补全缺失 cwd", () => {
    const input = [
      { id: "g1", name: "dev", command: "npm run dev" },
      { id: "g2", name: "build", command: "npm run build", cwd: "/abs" },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toEqual([
      { id: "g1", name: "dev", command: "npm run dev", cwd: "", visible: true, rescanOnExit: false },
      { id: "g2", name: "build", command: "npm run build", cwd: "/abs", visible: true, rescanOnExit: false },
    ]);
  });

  it("新形状保留 visible:false", () => {
    const input = [
      { id: "g1", name: "dev", command: "npm run dev", cwd: "", visible: false },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toEqual([
      { id: "g1", name: "dev", command: "npm run dev", cwd: "", visible: false, rescanOnExit: false },
    ]);
  });

  it("旧形状单预设组拆为 1 个新组", () => {
    const input = [
      {
        id: "old1",
        name: "dev-group",
        presets: [{ name: "frontend", command: "npm run dev", cwd: "/p" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("frontend");
    expect(out[0].command).toBe("npm run dev");
    expect(out[0].cwd).toBe("/p");
    expect(out[0].id).not.toBe("old1"); // 重新分配
  });

  it("旧形状多预设组拆为 N 个新组", () => {
    const input = [
      {
        id: "old1",
        name: "fallback",
        presets: [
          { name: "a", command: "cmd-a", cwd: "" },
          { name: "b", command: "cmd-b", cwd: "/b" },
          { name: "c", command: "cmd-c", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(3);
    expect(out.map((g) => g.name)).toEqual(["a", "b", "c"]);
    expect(out.map((g) => g.command)).toEqual(["cmd-a", "cmd-b", "cmd-c"]);
    expect(out.map((g) => g.cwd)).toEqual(["", "/b", ""]);
  });

  it("预设缺 name 时回退到组名", () => {
    const input = [
      {
        id: "old",
        name: "group-name",
        presets: [{ name: "", command: "echo hi", cwd: "" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].name).toBe("group-name");
  });

  it("预设 command 和 name 都为空时丢弃", () => {
    const input = [
      {
        id: "old",
        name: "g",
        presets: [
          { name: "", command: "", cwd: "" },
          { name: "ok", command: "echo", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("ok");
  });

  it("混合新旧形状都正确处理", () => {
    const input = [
      { id: "new1", name: "n1", command: "c1", cwd: "" },
      {
        id: "old1",
        name: "g1",
        presets: [{ name: "p1", command: "c2", cwd: "" }],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("new1");
    expect(out[1].name).toBe("p1");
  });

  it("生成的 id 互不相同", () => {
    const input = [
      {
        id: "old",
        name: "g",
        presets: [
          { name: "a", command: "ca", cwd: "" },
          { name: "b", command: "cb", cwd: "" },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(new Set(out.map((g) => g.id)).size).toBe(out.length);
  });

  it("新形状保留 rescanOnExit:true", () => {
    // 回归:启动时 migrate 会重塑每个 group,rescanOnExit 必须被显式复制,
    // 否则设置页 checkbox 永远显示为 unchecked,用户的「进程退出后自动重新扫描」失效。
    const input = [
      { id: "g1", name: "dev", command: "npm run dev", cwd: "", rescanOnExit: true },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].rescanOnExit).toBe(true);
  });

  it("新形状保留 rescanOnExit:false", () => {
    const input = [
      { id: "g1", name: "dev", command: "npm run dev", cwd: "", rescanOnExit: false },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].rescanOnExit).toBe(false);
  });

  it("新形状缺 rescanOnExit 时归一为 false", () => {
    // 显式归一避免 undefined 漂移;UI 读 rescanOnExit ?? false 也好,
    // 显式 false 让数据形状稳定。
    const input = [
      { id: "g1", name: "dev", command: "npm run dev", cwd: "" },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].rescanOnExit).toBe(false);
  });

  it("旧形状 preset 若带 rescanOnExit 也保留", () => {
    // 防御:旧 preset 数组里若曾临时存过 rescanOnExit(开发期调试),
    // 升级路径不应丢失用户的选择。
    const input = [
      {
        id: "old1",
        name: "fallback",
        presets: [
          { name: "a", command: "cmd-a", cwd: "", rescanOnExit: true },
        ],
      },
    ];
    const out = migrateCommandGroups(input);
    expect(out[0].rescanOnExit).toBe(true);
  });
});