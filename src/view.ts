import { FileSystemAdapter, ItemView, Modal, Notice, setIcon, Setting } from "obsidian";
import {
  createTab,
  isRunning,
  RunnerTab,
  startProcess,
  stopProcess,
} from "./runner";

export const RUNNER_VIEW_TYPE = "local-runner-view";

/**
 * Right-sidebar console view. Holds a set of process tabs, each running one
 * shell command and streaming its output into a shared output pane.
 */
export class RunnerView extends ItemView {
  private tabs: RunnerTab[] = [];
  private activeId: string | null = null;

  // DOM caches (assigned in onOpen, used only after that).
  private rootEl!: HTMLElement;
  private tabBarEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private outputEl!: HTMLElement;

  // Coalesce rapid stdout chunks into a single paint per animation frame.
  private rafScheduled = false;
  // Follow output to the bottom unless the user has scrolled up.
  private stickToBottom = true;

  getViewType(): string {
    return RUNNER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "本地进程";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.scheduleRender();
  }

  async onClose(): Promise<void> {
    // Kill every running process so no orphaned dev servers linger.
    for (const tab of this.tabs) {
      if (tab.child) {
        stopProcess(tab, () => {});
      }
    }
  }

  // ---- UI scaffolding -----------------------------------------------------

  private buildUi(): void {
    const root = this.contentEl.createDiv({ cls: "runner-view" });
    this.rootEl = root;

    const toolbar = root.createDiv({ cls: "runner-toolbar" });
    this.tabBarEl = toolbar.createDiv({ cls: "runner-tabs" });

    const addBtn = toolbar.createDiv({ cls: "runner-tab-add", title: "新建进程" });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.openNewTabModal());

    this.controlsEl = root.createDiv({ cls: "runner-controls" });

    this.outputEl = root.createEl("pre", { cls: "runner-output" });
    this.outputEl.addEventListener("scroll", () => {
      const nearBottom =
        this.outputEl.scrollHeight - this.outputEl.scrollTop - this.outputEl.clientHeight < 30;
      this.stickToBottom = nearBottom;
    });
  }

  private buildControls(): void {
    this.controlsEl.empty();
    const tab = this.getActiveTab();

    const runLabel = tab && isRunning(tab) ? "重启" : "运行";
    new Setting(this.controlsEl)
      .addButton((b) =>
        b
          .setButtonText(runLabel)
          .setCta()
          .setDisabled(!tab)
          .onClick(() => this.runOrRestart(tab)),
      )
      .addButton((b) =>
        b
          .setButtonText("停止")
          .setDisabled(!tab || !isRunning(tab))
          .onClick(() => tab && stopProcess(tab, () => this.scheduleRender())),
      )
      .addButton((b) =>
        b
          .setButtonText("清空")
          .setDisabled(!tab)
          .onClick(() => {
            if (tab) {
              tab.output = "";
              this.stickToBottom = true;
              this.scheduleRender();
            }
          }),
      );
  }

  // ---- Rendering ----------------------------------------------------------

  private scheduleRender(): void {
    if (this.rafScheduled) {
      return;
    }
    this.rafScheduled = true;
    window.requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.renderTabs();
      this.buildControls();
      this.renderOutput();
    });
  }

  private renderTabs(): void {
    this.tabBarEl.empty();
    for (const tab of this.tabs) {
      const item = this.tabBarEl.createDiv({
        cls: [
          "runner-tab",
          tab.id === this.activeId ? "is-active" : "",
          `is-${tab.status}`,
        ],
      });

      const dot = item.createSpan({ cls: "runner-tab-dot" });
      dot.setAttr("title", tabTitleSuffix(tab));

      const label = item.createSpan({ cls: "runner-tab-label", text: tab.command });
      label.setAttr("title", `${tab.command}\n${tab.cwd}`);

      const close = item.createSpan({ cls: "runner-tab-close", text: "×" });
      close.setAttr("title", "关闭");

      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("runner-tab-close")) {
          this.closeTab(tab.id);
        } else {
          this.setActive(tab.id);
        }
      });

      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isRunning(tab)) {
          stopProcess(tab, () => this.scheduleRender());
        } else {
          startProcess(tab, () => this.scheduleRender());
        }
      });
    }
  }

  private renderOutput(): void {
    const tab = this.getActiveTab();
    if (!tab) {
      this.outputEl.empty();
      this.outputEl.createEl("div", {
        cls: "runner-empty",
        text: this.tabs.length === 0 ? "点击 ＋ 新建一个进程" : "选择左侧标签页查看输出",
      });
      return;
    }

    this.outputEl.setText(tab.output || "");
    if (this.stickToBottom) {
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }
  }

  // ---- Tab actions --------------------------------------------------------

  private getActiveTab(): RunnerTab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  private setActive(id: string): void {
    this.activeId = id;
    this.stickToBottom = true;
    this.scheduleRender();
  }

  private runOrRestart(tab: RunnerTab | null): void {
    if (!tab) {
      return;
    }
    if (isRunning(tab)) {
      stopProcess(tab, () => startProcess(tab, () => this.scheduleRender()));
    } else {
      startProcess(tab, () => this.scheduleRender());
    }
  }

  private closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) {
      return;
    }
    const tab = this.tabs[idx];
    if (tab.child) {
      stopProcess(tab, () => {});
    }
    this.tabs.splice(idx, 1);

    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeId = next ? next.id : null;
      this.stickToBottom = true;
    }
    this.scheduleRender();
  }

  // ---- New process modal --------------------------------------------------

  private openNewTabModal(): void {
    const adapter = this.app.vault.adapter;
    const defaultCwd =
      adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    new NewCommandModal(this.app, defaultCwd, (command, cwd) => {
      const tab = createTab(command, cwd);
      this.tabs.push(tab);
      this.activeId = tab.id;
      this.stickToBottom = true;
      startProcess(tab, () => this.scheduleRender());
      this.scheduleRender();
    }).open();
  }
}

function tabTitleSuffix(tab: RunnerTab): string {
  if (tab.status === "running") return "运行中(点击停止)";
  if (tab.status === "stopped") return "已停止(点击运行)";
  return `已退出 · 代码 ${tab.exitCode}(点击运行)`;
}

/** Modal that collects a command and working directory for a new process. */
class NewCommandModal extends Modal {
  private command = "";
  private cwd: string;
  private readonly defaultCwd: string;
  private readonly onSubmit: (command: string, cwd: string) => void;

  constructor(
    app: import("obsidian").App,
    defaultCwd: string,
    onSubmit: (command: string, cwd: string) => void,
  ) {
    super(app);
    this.defaultCwd = defaultCwd;
    this.cwd = defaultCwd;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.titleEl.setText("新建本地进程");

    const cmdSetting = new Setting(this.contentEl)
      .setName("命令")
      .setDesc("任意 shell 命令,如 npm run dev、npx vite");
    cmdSetting.addText((t) => {
      t.setPlaceholder("npm run dev").onChange((v) => (this.command = v));
      t.inputEl.focus();
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.submit();
        }
      });
    });

    new Setting(this.contentEl)
      .setName("工作目录")
      .setDesc("默认为当前 vault 根目录")
      .addText((t) => {
        t.setValue(this.defaultCwd).onChange((v) => (this.cwd = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.submit();
          }
        });
      });

    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("运行")
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const command = this.command.trim();
    if (!command) {
      new Notice("请输入要运行的命令");
      return;
    }
    const cwd = this.cwd.trim() || this.defaultCwd;
    this.close();
    this.onSubmit(command, cwd);
  }
}
