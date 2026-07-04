import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Notice } from "obsidian";

/** 已注册安装 skill 的持久化结构(写入 PluginSettings.installedSkills) */
export interface InstalledSkill {
  /** 本地落盘目录名(由 degit 源末段推导) */
  name: string;
  /** 用户在设置页填写的 degit 源串(如 "owner/repo/skills/dir#ref") */
  src: string;
  /** <vault>/.claude/skills/<name> 的绝对路径 */
  dest: string;
}

/** 安装/卸载回调 */
export type Done = (success: boolean, message?: string) => void;

/** 把 degit 源路径末段解析为合法的本地目录名(允许字母/数字/点/下划线/连字符)。 */
export function deriveName(src: string): string {
  const stripped = src.split("#")[0].replace(/\/+$/, "");
  const segments = stripped.split("/").filter((s) => s.length > 0);
  const name = segments[segments.length - 1] ?? "";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`无法从源解析合法目录名: ${src}`);
  }
  return name;
}

/** <vault>/.claude/skills/<name> 绝对路径 */
export function getSkillDestDir(vault: string, name: string): string {
  return path.join(vault, ".claude", "skills", name);
}

/** 扫描 vault/.claude/skills,返回其中已存在的子目录名(按字典序)。 */
export function listInstalled(vault: string): string[] {
  const skillsDir = path.join(vault, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** 在 vault 目录执行 shell 命令,捕获 stderr,完成后回调。 */
export function runInVault(
  vault: string,
  command: string,
  onDone: (success: boolean, message: string) => void,
): void {
  if (!vault) {
    onDone(false, "无法获取 vault 路径");
    return;
  }

  const child = spawn(command, {
    cwd: vault,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  child.on("error", (err: Error) => onDone(false, err.message));
  child.on("close", (code: number | null) => {
    onDone(code === 0, stderr.trim());
  });
}

/** 安装 skill:删除旧 dest(若存在),跑 degit,验证 dest 存在后回调。 */
export function installSkill(
  vault: string,
  src: string,
  notice: (m: string) => void = (m) => new Notice(m),
  onDone: Done,
): void {
  if (!vault) {
    notice("无法获取 vault 路径");
    onDone(false);
    return;
  }

  let name: string;
  try {
    name = deriveName(src);
  } catch (err) {
    notice(`❌ ${(err as Error).message}`);
    onDone(false);
    return;
  }

  const dest = getSkillDestDir(vault, name);
  // 调试信息:console.debug 避开 obsidianmd/rule-custom-message。
  console.debug("[Local Runner] install skill — vault cwd:", vault);
  console.debug("[Local Runner] install skill — dest:", dest);
  console.debug(
    "[Local Runner] install skill — command:",
    `npx --yes degit ${src} ${dest}`,
  );

  notice(`正在安装 ${name}…`);

  if (fs.existsSync(dest)) {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch (err) {
      notice(`❌ 清理旧目录失败: ${(err as Error).message}`);
      onDone(false);
      return;
    }
  }

  runInVault(vault, `npx --yes degit ${src} ${dest}`, (ok, msg) => {
    if (!ok) {
      notice(`❌ 安装 skill 失败: ${msg || "未知错误"}`);
      onDone(false);
      return;
    }
    if (!fs.existsSync(dest)) {
      notice("❌ degit 未生成目标目录,请检查源 URL");
      onDone(false);
      return;
    }
    notice(`✅ ${name} 已安装`);
    onDone(true);
  });
}

/** 卸载 skill:删除目录,缺失则当作已卸载(idempotent)。 */
export function uninstallSkill(
  vault: string,
  name: string,
  notice: (m: string) => void = (m) => new Notice(m),
  onDone: Done,
): void {
  if (!vault) {
    onDone(false);
    return;
  }
  const dest = getSkillDestDir(vault, name);
  if (!fs.existsSync(dest)) {
    notice(`已移除 ${name}`);
    onDone(true);
    return;
  }
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    notice(`已移除 ${name}`);
    onDone(true);
  } catch (err) {
    notice(`❌ 移除 skill 失败: ${(err as Error).message}`);
    onDone(false);
  }
}
