import { Notice, Setting } from "obsidian";
import * as fs from "fs";
import type { PluginSettings } from "../types/settings";
import type { InstalledSkill } from "../skills/installer";
import { installSkill, uninstallSkill } from "../skills/installer";
import {
  prepareInstallAction,
  truncateSrc,
} from "../skills/skill-row";

/** 设置页需要的主机能力最小集。 */
export interface SkillSectionHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  getDefaultCwd(): string;
}

/** 重渲染整个 skill 设置区域(供增删行时回调)。 */
function rerender(containerEl: HTMLElement, host: SkillSectionHost): void {
  containerEl.empty();
  render(containerEl, host);
}

/**
 * 渲染「skill 管理」整段:顶部说明 + 添加行 + 已装列表。
 * 不使用任何 modal;添加 / 卸载全部在设置页内联完成。
 */
export function render(containerEl: HTMLElement, host: SkillSectionHost): void {
  // 顶部说明
  new Setting(containerEl)
    .setName("从远端仓库安装 skill")
    .setDesc(
      createFragment((frag) => {
        frag.appendText(
          "填入 degit 源路径(owner/repo/skills/<dir>#<ref>) 即可下载到当前仓库的 .claude/skills/<dir> 目录。不填则无法安装。",
        );
      }),
    );

  // 添加行
  let inputText = "";
  let busy = false;
  // button / refresh 在 addText 与 addButton 之间共享:用外层闭包持有,
  // 让 onChange 能在输入变化时立即重算按钮启用态(否则填了源也点不动)。
  let installButton: import("obsidian").ButtonComponent | null = null;
  const refresh = (): void => {
    if (!installButton) return;
    const action = prepareInstallAction(
      host.settings.installedSkills,
      host.getDefaultCwd(),
      inputText,
    );
    installButton
      .setDisabled(!action.ok || busy)
      .setTooltip(action.reason ?? "");
  };

  new Setting(containerEl)
    .setName("远端源")
    .addText((t) => {
      t.setPlaceholder("ZHLX2005/sl/skills/<skill-name>#main");
      t.onChange((v) => {
        inputText = v;
        refresh();
      });
    })
    .addButton((b) => {
      installButton = b;
      b.setCta().setButtonText("安装").setTooltip("源不能为空");
      refresh();
      b.onClick(() => {
        if (busy) return;
        const action = prepareInstallAction(
          host.settings.installedSkills,
          host.getDefaultCwd(),
          inputText,
        );
        if (!action.ok || !action.args) {
          // reason 在 tooltip 中已展示;同时弹一次 Notice 让用户明确感知失败。
          if (action.reason) new Notice(`❌ ${action.reason}`);
          return;
        }
        busy = true;
        b.setDisabled(true).setButtonText("安装中…");
        installSkill(action.args.vault, action.args.src, () => {}, (ok) => {
          busy = false;
          b.setDisabled(false).setButtonText("安装");
          if (ok) {
            const entry: InstalledSkill = {
              name: action.args!.name,
              src: action.args!.src,
              dest: action.args!.dest,
            };
            host.settings.installedSkills.push(entry);
            void host.saveSettings().then(() => rerender(containerEl, host));
          } else {
            // 失败也要按当前输入重算禁用态(tooltip/启用)
            refresh();
          }
        });
      });
    });

  // 已装列表
  for (const skill of host.settings.installedSkills) {
    new Setting(containerEl)
      .setName(skill.name)
      .setDesc(
        createFragment((frag) => {
          frag.createEl("code", { text: truncateSrc(skill.src) });
          if (skill.src.length > 60) {
            frag.createEl("span", {
              text: " (完整路径见 title)",
              attr: { title: skill.src },
            });
          }
        }),
      )
      .addButton((b) => {
        // 同时给图标和文字:只靠 trash 图标在浅色/无 hover 时看不清,
        // 文字「卸载」保证可见性,tooltip 给出完整 skill 名。
        // mod-warning 代替已废弃的 setWarning():其替代 setDestructive() 需 Obsidian 1.13+,
        // 高于本插件 minAppVersion 1.7.2,故直接打 Obsidian 稳定按钮类名保留原 warning 样式。
        b.buttonEl.addClass("mod-warning");
        b.setIcon("trash")
          .setButtonText("卸载")
          .setTooltip(`卸载 ${skill.name}`)
          .onClick(() => {
            b.setDisabled(true);
            uninstallSkill(
              host.getDefaultCwd(),
              skill.name,
              () => {},
              (ok) => {
                if (!ok) {
                  b.setDisabled(false);
                  return;
                }
                host.settings.installedSkills = host.settings.installedSkills.filter(
                  (s) => s.name !== skill.name,
                );
                void host.saveSettings().then(() => rerender(containerEl, host));
              },
            );
          });
      });
  }
}

/**
 * Boot 期自校正:把 dest 已不存在的条目剪掉,持久化只写一次。
 * 返回是否有变更。供 `main.ts` `onload` 调用。
 */
export function reconcileInstalledFlag(
  settings: PluginSettings,
  vault: string,
): boolean {
  if (!vault) return false;
  const before = settings.installedSkills.length;
  settings.installedSkills = settings.installedSkills.filter((s) => {
    try {
      return fs.existsSync(s.dest);
    } catch {
      return false;
    }
  });
  return settings.installedSkills.length !== before;
}