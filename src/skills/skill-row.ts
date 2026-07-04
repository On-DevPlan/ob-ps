import type { InstalledSkill } from "./installer";
import { deriveName } from "./installer";
import * as path from "path";

/** 输入框值在什么情况下应被视为「空」(禁用安装按钮)。 */
export function isSrcEmpty(input: string): boolean {
  return input.trim().length === 0;
}

/** 已装列表里是否已有同名 skill(基于推出来的 name)。 */
export function hasNameCollision(entries: InstalledSkill[], candidateName: string): boolean {
  return entries.some((e) => e.name === candidateName);
}

/** src 字符串截断到 n 字符以内,过长加 …,供列表展示用。 */
export function truncateSrc(src: string, max = 60): string {
  return src.length <= max ? src : src.slice(0, max - 1) + "…";
}

export interface InstallAction {
  ok: boolean;
  reason?: string;
  args?: { vault: string; src: string; name: string; dest: string };
}

export function prepareInstallAction(
  entries: InstalledSkill[],
  vault: string,
  src: string,
): InstallAction {
  if (!vault) return { ok: false, reason: "vault 未配置" };
  if (isSrcEmpty(src)) return { ok: false, reason: "源不能为空" };
  let name: string;
  try {
    name = deriveName(src);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (hasNameCollision(entries, name)) {
    return { ok: false, reason: `已存在同名 skill「${name}」,请先卸载` };
  }
  return {
    ok: true,
    args: {
      vault,
      src,
      name,
      dest: path.join(vault, ".claude", "skills", name),
    },
  };
}