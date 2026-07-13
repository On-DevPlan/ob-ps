import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunnerTab } from "./process-model";
import type { CommandGroup } from "../types/commands";

// 捕获 startProcess 调用,避免真实 spawn。沿用 installer.test.ts 的 vi.mock 模式。
const startProcessMock = vi.fn();
vi.mock("./process-lifecycle", () => ({
  startProcess: (...args: unknown[]): void => {
    startProcessMock(...args);
  },
}));

import { launchProcess, pickFirstVisibleGroup } from "./process-launch";
import type { LaunchDeps } from "./process-launch";

function makeTab(overrides: Partial<RunnerTab> = {}): RunnerTab {
  return {
    id: "t1",
    name: "n",
    command: "npm run dev",
    cwd: "/old",
    status: "stopped",
    exitCode: null,
    output: "stale",
    child: null,
    generation: 0,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<CommandGroup> = {}): CommandGroup {
  return {
    id: "g1",
    name: "dev",
    command: "npm run dev",
    cwd: "/grp",
    visible: true,
    rescanOnExit: true,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    tab: makeTab(),
    group: makeGroup(),
    activeNotePath: "note/a.md",
    defaultCwd: "/vault",
    onChange: () => {},
    onExit: () => {},
    ...overrides,
  };
}

describe("launchProcess", () => {
  beforeEach(() => startProcessMock.mockReset());

  it("每次启动都向 startProcess 传入 onExit(重复运行回归)", () => {
    const onExit = vi.fn();
    const deps = makeDeps({ onExit });
    launchProcess(deps);
    launchProcess(deps);
    expect(startProcessMock).toHaveBeenCalledTimes(2);
    for (const call of startProcessMock.mock.calls) {
      // 第三个参数永远是传入的 onExit(修复前 toggleProcess 路径会漏传)
      expect(call[2]).toBe(onExit);
    }
  });

  it("同步 command group 的 name/cwd/rescanOnExit(cwd 保留 defaultCwd 兜底)", () => {
    const tab = makeTab({ name: "old", cwd: "/old", rescanOnExit: false });
    launchProcess(
      makeDeps({
        tab,
        group: makeGroup({ name: "new", cwd: "", rescanOnExit: true }),
        defaultCwd: "/vault",
      }),
    );
    expect(tab.name).toBe("new");
    expect(tab.cwd).toBe("/vault"); // 空 cwd → defaultCwd
    expect(tab.rescanOnExit).toBe(true);
  });

  it("group.cwd 非空时不走 defaultCwd 兜底", () => {
    const tab = makeTab();
    launchProcess(makeDeps({ tab, group: makeGroup({ cwd: "/grp" }) }));
    expect(tab.cwd).toBe("/grp");
  });

  it("每次启动刷新 rescanTargetPath 为当前活动笔记", () => {
    const tab = makeTab({ rescanTargetPath: "old/x.md" });
    launchProcess(makeDeps({ tab, activeNotePath: "first.md" }));
    expect(tab.rescanTargetPath).toBe("first.md");
    launchProcess(makeDeps({ tab, activeNotePath: "second.md" }));
    expect(tab.rescanTargetPath).toBe("second.md");
  });

  it("清空本次输出", () => {
    const tab = makeTab({ output: "previous run" });
    launchProcess(makeDeps({ tab }));
    expect(tab.output).toBe("");
  });

  it("group 为 null 时保留 tab 现有字段,但仍清空输出并注册 onExit", () => {
    const onExit = vi.fn();
    const tab = makeTab({ name: "keep", cwd: "/keep", rescanOnExit: true, output: "x" });
    launchProcess(makeDeps({ tab, group: null, onExit }));
    expect(tab.name).toBe("keep");
    expect(tab.cwd).toBe("/keep");
    expect(tab.rescanOnExit).toBe(true);
    expect(tab.output).toBe("");
    expect(startProcessMock.mock.calls[0][2]).toBe(onExit);
  });

  it("activeNotePath 为 null 时 rescanTargetPath 置 undefined", () => {
    const tab = makeTab();
    launchProcess(makeDeps({ tab, activeNotePath: null }));
    expect(tab.rescanTargetPath).toBeUndefined();
  });
});

describe("pickFirstVisibleGroup", () => {
  it("返回第一个 visible 且 command 匹配的组", () => {
    const groups = [
      makeGroup({ id: "g0", command: "other" }),
      makeGroup({ id: "g1", command: "npm run dev" }),
      makeGroup({ id: "g2", command: "npm run dev" }),
    ];
    expect(pickFirstVisibleGroup(groups, "npm run dev")?.id).toBe("g1");
  });

  it("跳过 visible:false 的组", () => {
    const groups = [
      makeGroup({ id: "g1", command: "npm run dev", visible: false }),
      makeGroup({ id: "g2", command: "npm run dev", visible: true }),
    ];
    expect(pickFirstVisibleGroup(groups, "npm run dev")?.id).toBe("g2");
  });

  it("无匹配返回 null", () => {
    expect(pickFirstVisibleGroup([], "x")).toBeNull();
    expect(pickFirstVisibleGroup([makeGroup({ command: "x" })], "y")).toBeNull();
  });
});
