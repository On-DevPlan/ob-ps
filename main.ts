import { Plugin, WorkspaceLeaf } from "obsidian";
import { RUNNER_VIEW_TYPE, RunnerView } from "./src/view";

/**
 * Local Runner — an Obsidian sidebar that spawns local shell commands
 * (e.g. `npm run dev`) and streams their output into per-command tabs.
 *
 * Desktop only: relies on Node's `child_process`, which is unavailable in
 * the mobile sandbox.
 */
export default class LocalRunnerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(RUNNER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new RunnerView(leaf));

    this.addRibbonIcon("terminal", "本地进程", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-local-runner",
      name: "打开本地进程侧边栏",
      callback: () => {
        void this.activateView();
      },
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(RUNNER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: RUNNER_VIEW_TYPE, active: true });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}
