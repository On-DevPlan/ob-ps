/**
 * installer.test.ts — deriveName / getSkillDestDir / listInstalled /
 * installSkill / uninstallSkill 单测.
 *
 * installSkill 的 degit spawn 通过把 installer.ts 中的 runInVault 重写
 * 为由测试注入的函数来验证(见 vi.mock 块)。详见 Task 3。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as installer from "./installer";

describe("deriveName", () => {
  it("extracts last path segment when #ref present", () => {
    expect(installer.deriveName("ZHLX2005/sl/skills/foo#main")).toBe("foo");
  });

  it("extracts last segment without #ref", () => {
    expect(installer.deriveName("ZHLX2005/sl/skills/foo")).toBe("foo");
  });

  it("throws on empty input", () => {
    expect(() => installer.deriveName("")).toThrow();
  });

  it("throws on illegal characters", () => {
    expect(() => installer.deriveName("a/b/c d#main")).toThrow();
    expect(() => installer.deriveName("a/b/c*d#main")).toThrow();
  });
});

describe("getSkillDestDir", () => {
  it("joins vault + .claude/skills + name", () => {
    const got = installer.getSkillDestDir("/tmp/vault", "foo");
    expect(got).toBe(path.join("/tmp/vault", ".claude", "skills", "foo"));
  });
});

describe("listInstalled", () => {
  it("returns sorted names of immediate subdirectories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "installer-list-"));
    const skillsDir = path.join(tmp, ".claude", "skills");
    fs.mkdirSync(path.join(skillsDir, "beta"), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, "alpha"), { recursive: true });
    // Pretend file is also present; should be filtered out.
    fs.writeFileSync(path.join(skillsDir, "README.md"), "x");

    expect(installer.listInstalled(tmp)).toEqual(["alpha", "beta"]);
  });

  it("returns [] when .claude/skills is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "installer-empty-"));
    expect(installer.listInstalled(tmp)).toEqual([]);
  });
});

function makeFakeChild(_code: number | null, _stderr: string) {
  const ee = new EventEmitter();
  // The installer calls `child.stderr.on("data", ...)`; provide a stub stream.
  (ee as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  return ee;
}

// installSkill spawns via `child_process.spawn` (runInVault). Node 22 marks
// `cp.spawn` as non-configurable, so vi.spyOn(cp, "spawn") throws "Cannot
// redefine property". vi.mock of the module replaces it cleanly per-test.
const spawnMock = vi.fn();

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args) as import("child_process").ChildProcess,
  };
});

describe("installSkill — with mock spawn", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("successfully installs: rmSync runs, degit fires, onDone(true)", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const ee = makeFakeChild(0, "");
      // Fake degit: recreate the dest directory before emitting close so
      // installSkill's post-spawn `fs.existsSync(dest)` check passes. The
      // dest path is embedded in the command string ("npx --yes degit <src> <dest>").
      const cmd = _args[0] as string;
      const destArg = cmd.trim().split(/\s+/).pop();
      process.nextTick(() => {
        if (destArg) fs.mkdirSync(destArg, { recursive: true });
        ee.emit("close", 0);
      });
      return ee;
    });

    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "inst-ok-"));
    const skillsRoot = path.join(vault, ".claude", "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    // Pre-create the destination to exercise the rmSync branch.
    const dest = path.join(skillsRoot, "foo");
    fs.mkdirSync(dest, { recursive: true });

    const onDone = vi.fn();
    installer.installSkill(vault, "owner/repo/skills/foo#main", () => {}, (ok) => { onDone(ok); });

    await new Promise((r) => setImmediate(r));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // installSkill invokes onDone(true) with no second arg.
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it("failure: non-zero exit → onDone(false), notice contains failure msg", async () => {
    spawnMock.mockImplementation((..._args: unknown[]) => {
      const ee = makeFakeChild(1, "degit failed");
      process.nextTick(() => {
        (ee as unknown as { stderr: EventEmitter }).stderr.emit("data", Buffer.from("degit failed"));
        ee.emit("close", 1);
      });
      return ee;
    });

    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "inst-fail-"));
    fs.mkdirSync(path.join(vault, ".claude", "skills"), { recursive: true });

    const onDone = vi.fn();
    const notices: string[] = [];
    installer.installSkill(
      vault,
      "owner/repo/skills/foo#main",
      (m) => notices.push(m),
      (ok) => { onDone(ok); },
    );

    await new Promise((r) => setImmediate(r));
    // installSkill invokes onDone(false) with no second arg; the failure
    // message is delivered through the notice callback instead.
    expect(onDone).toHaveBeenCalledWith(false);
    expect(notices.some((n) => n.includes("安装 skill 失败"))).toBe(true);
    expect(notices.some((n) => n.includes("degit failed"))).toBe(true);
  });

  it("invalid source name → onDone(false), no spawn", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "inst-bad-"));
    const onDone = vi.fn();
    installer.installSkill(vault, "a/b/c d#main", () => {}, onDone);
    expect(onDone).toHaveBeenCalledWith(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("uninstallSkill", () => {
  it("removes existing dest and reports success", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "un-ok-"));
    const dest = path.join(vault, ".claude", "skills", "foo");
    fs.mkdirSync(dest, { recursive: true });

    const onDone = vi.fn();
    installer.uninstallSkill(vault, "foo", () => {}, onDone);
    expect(fs.existsSync(dest)).toBe(false);
    // uninstallSkill invokes onDone(true) with no second arg.
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it("missing dest is treated as success (idempotent)", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "un-missing-"));
    const onDone = vi.fn();
    installer.uninstallSkill(vault, "nope", () => {}, onDone);
    expect(onDone).toHaveBeenCalledWith(true);
  });
});
