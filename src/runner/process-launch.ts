import type { CommandGroup } from "../types/commands";
import { startProcess, type ProcChangeKind } from "./process-lifecycle";
import type { RunnerTab } from "./process-model";

/** `launchProcess` 的依赖,全部以参数注入以保持纯函数可单测。 */
export interface LaunchDeps {
  tab: RunnerTab;
  /** 按 command 解析出的当前可见命令组;null 时保留 tab 现有字段。 */
  group: CommandGroup | null;
  /** 本次启动时的活动笔记路径,退出后按它扫描。 */
  activeNotePath: string | null;
  /** vault 根目录,group.cwd 为空时兜底。 */
  defaultCwd: string;
  /** 进程流/状态变更回调(透传给 startProcess)。 */
  onChange: (kind: ProcChangeKind) => void;
  /** 进程成功退出回调(透传给 startProcess;仅 exit code 0 时由 runner 上报)。 */
  onExit: (tab: RunnerTab) => void | Promise<void>;
}

/** 在可见命令组中取第一个 command 匹配者(与 syncTabsWithCommandGroups 同规则)。 */
export function pickFirstVisibleGroup(
  groups: CommandGroup[],
  command: string,
): CommandGroup | null {
  for (const g of groups) {
    if (g.visible === false) continue;
    if (g.command === command) return g;
  }
  return null;
}

/**
 * 统一执行一次进程启动前的准备并启动:
 * 1. 用当前 command group 同步 name/cwd/rescanOnExit(cwd 保留 defaultCwd 兜底)
 * 2. 清空本次输出
 * 3. 记录本次启动时的活动笔记路径
 * 4. 始终向 startProcess 传入 onExit(仅 exit code 0 时由 runner 上报)
 *
 * 视图的首次创建与退出/停止后重启都走这里,避免重复运行时丢失退出回调。
 */
export function launchProcess(deps: LaunchDeps): void {
  const { tab, group, activeNotePath, defaultCwd, onChange, onExit } = deps;
  if (group) {
    tab.name = group.name;
    tab.cwd = group.cwd || defaultCwd;
    tab.rescanOnExit = group.rescanOnExit === true;
  }
  tab.output = "";
  tab.rescanTargetPath = activeNotePath ?? undefined;
  startProcess(tab, onChange, onExit);
}
