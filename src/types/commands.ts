/**
 * 命令组(用户自定义的快捷命令)
 * 控制侧边栏快捷启动按钮的集合。
 *
 * 重构 2026-06-23:扁平化,组本身即一条命令,取消原先的 presets 数组。
 */
export interface CommandGroup {
  id: string;
  name: string;     // = 命令显示名
  command: string;  // 单条命令
  cwd: string;      // 工作目录(空表示用默认)
  /** 是否在侧边栏显示(默认 true) */
  visible?: boolean;
  /**
   * 进程成功退出后,自动重新扫描"启动时记录的活动笔记"的双链树。
   * 用途:dev server 跑完后,捕获新创建的笔记,刷新双链树。
   * 默认 false(显式 opt-in,避免 dev server 长期跑用户的端口被频繁触发)。
   */
  rescanOnExit?: boolean;
}