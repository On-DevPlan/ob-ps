import type { RunnerTab } from "./process-model";

/** 进程标签页 ID 自增计数器(模块内单例) */
let idCounter = 0;

/**
 * 创建一个尚未启动的新标签页
 *
 * @param rescanOnExit 进程成功退出后,自动重新扫描启动时记录的活动笔记双链树。
 *                     显式 opt-in,避免 dev server 等长期进程被频繁触发。
 */
export function createTab(
  name: string,
  command: string,
  cwd: string,
  rescanOnExit = false,
): RunnerTab {
  idCounter += 1;
  return {
    id: `${Date.now().toString(36)}-${idCounter}`,
    name,
    command,
    cwd,
    status: "stopped",
    exitCode: null,
    output: "",
    child: null,
    generation: 0,
    rescanOnExit,
  };
}
