import { createTab } from "./process-factory";
import type { RunnerTab } from "./process-model";

/** 启动或创建进程标签页的最小能力 —— 由 RunnerView 实现 */
export interface RunnerHost {
  /**
   * 若 command 已存在则复用并启动;否则新建标签页并启动。
   * 不切换视图、不弹出 UI。
   */
  startOrCreateTab(name: string, command: string, cwd: string, rescanOnExit?: boolean): RunnerTab;

  /**
   * 按 command 查找已有标签页;不存在返回 null。
   * 供状态查询使用(按钮图标 + 弹窗),不修改任何 tab。
   */
  findTabByCommand(command: string): RunnerTab | null;
}

/**
 * 在已有 tabs 中查找同名 command;若不存在则创建新 tab。
 * 纯函数 —— 不修改入参数组,便于单测。
 */
export function resolveOrCreateTab(
  tabs: RunnerTab[],
  name: string,
  command: string,
  cwd: string,
  rescanOnExit = false,
): { tab: RunnerTab; created: boolean } {
  const existing = tabs.find((t) => t.command === command);
  if (existing) {
    return { tab: existing, created: false };
  }
  return { tab: createTab(name, command, cwd, rescanOnExit), created: true };
}
