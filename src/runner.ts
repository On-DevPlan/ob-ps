import { ChildProcess, spawn } from "child_process";

/**
 * Process lifecycle status for a single runner tab.
 * - running: child process is alive
 * - exited: process ended on its own (exit code recorded)
 * - stopped: user terminated the process
 */
export type RunnerStatus = "running" | "exited" | "stopped";

/**
 * A single command tab. The view owns an array of these; runner helpers
 * mutate the fields and notify the view via the supplied callback.
 */
export interface RunnerTab {
  id: string;
  command: string;
  cwd: string;
  status: RunnerStatus;
  exitCode: number | null;
  /** Plain-text output buffer. Capped to MAX_OUTPUT_CHARS. */
  output: string;
  /** The live child process, or null when not running. */
  child: ChildProcess | null;
}

/** Cap the in-memory output buffer so long-running servers do not leak memory. */
const MAX_OUTPUT_CHARS = 200_000;

let idCounter = 0;

/** Create a fresh, not-yet-started tab. */
export function createTab(command: string, cwd: string): RunnerTab {
  idCounter += 1;
  return {
    id: `${Date.now().toString(36)}-${idCounter}`,
    command,
    cwd,
    status: "running",
    exitCode: null,
    output: "",
    child: null,
  };
}

/** Append a chunk to the tab buffer, trimming from the front if it overflows. */
export function appendOutput(tab: RunnerTab, chunk: string): void {
  tab.output += chunk;
  if (tab.output.length > MAX_OUTPUT_CHARS) {
    tab.output = tab.output.slice(tab.output.length - MAX_OUTPUT_CHARS);
  }
}

export function isRunning(tab: RunnerTab): boolean {
  return tab.child !== null && tab.status === "running";
}

/**
 * Spawn the tab's command. No-op if already running.
 *
 * Uses `shell: true` so Windows `.cmd` shims (npm/npx) resolve correctly,
 * and so the user may type an arbitrary shell command (pipes, args, etc.).
 */
export function startProcess(tab: RunnerTab, onChange: () => void): void {
  if (tab.child) {
    return;
  }

  tab.status = "running";
  tab.exitCode = null;

  let child: ChildProcess;
  try {
    child = spawn(tab.command, {
      cwd: tab.cwd,
      shell: true,
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (err) {
    appendOutput(tab, `\n[启动失败] ${(err as Error).message}\n`);
    tab.status = "exited";
    tab.exitCode = -1;
    onChange();
    return;
  }

  tab.child = child;
  appendOutput(tab, `$ ${tab.command}  (cwd: ${tab.cwd})\n`);

  child.stdout?.on("data", (data: Buffer) => {
    appendOutput(tab, data.toString());
    onChange();
  });
  child.stderr?.on("data", (data: Buffer) => {
    appendOutput(tab, data.toString());
    onChange();
  });
  child.on("error", (err: Error) => {
    appendOutput(tab, `\n[错误] ${err.message}\n`);
    tab.status = "exited";
    tab.exitCode = -1;
    tab.child = null;
    onChange();
  });
  child.on("close", (code: number | null) => {
    tab.status = "exited";
    tab.exitCode = code;
    tab.child = null;
    appendOutput(tab, `\n[进程退出,代码 ${code}]\n`);
    onChange();
  });
}

/**
 * Terminate the tab's process. On Windows, kill the whole tree via taskkill
 * (a bare child.kill() only stops cmd.exe and leaves the dev server alive,
 * holding the port). Elsewhere, fall back to SIGTERM.
 */
export function stopProcess(tab: RunnerTab, onChange: () => void): void {
  const child = tab.child;
  if (!child) {
    return;
  }

  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      child.kill();
    }
  } catch (err) {
    console.error("[local-runner] stop failed", err);
  }

  tab.status = "stopped";
  tab.child = null;
  appendOutput(tab, "\n[已手动停止]\n");
  onChange();
}
