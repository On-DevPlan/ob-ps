---
name: obsidian-plugin-review
description: 构建/开发后检查 ob-ps 项目是否满足 Obsidian 官方插件审核标准。检查 manifest/README/源码/release 资产等维度。仅限 ob-ps 项目。
---

# Obsidian 插件审核合规检查

在 `npm run build` / `npm run lint` / `npm run dev` 等构建命令完成后执行,检查当前项目是否满足 Obsidian 官方插件审核(plugin review)标准。报告不达标项并给出修复建议,**不阻断操作**。

## 审查维度与判定标准

### 1. Source code — ESLint Error(硬性 Error,必须清零)

| # | 规则 | 判定标准 | 修复 |
|---|------|---------|------|
| E1 | `eslint-disable` 必须带描述 | 搜索 `// eslint-disable-next-line` 或 `// eslint-disable` 后面没有 `-- <reason>` 描述的即为不合格 | 在 disable 后加 `-- 为什么需要禁用` |
| E2 | 禁止禁用 `obsidianmd/*` 规则 | 搜索 `eslint-disable.*obsidianmd/` | 移除此 disable,改用合规写法(如 `console.log` 改用 `console.debug`) |
| E3 | 禁止禁用 `@typescript-eslint/no-deprecated` | 搜索 `eslint-disable.*no-deprecated` | 用替代 API 替换 deprecated 用法,而不是压制 |
| E4 | 使用 `activeDocument` 而非 `document` | 搜索 `document\.`(排除 `activeDocument` 自身) | 改用 `activeDocument`(Obsidian 全局,pouout 窗口兼容) |

### 2. manifest.json

| # | 字段 | 标准 | 示例 |
|---|------|------|------|
| M1 | `description` | 英文 + 以 `.`/`!`/`?` 结尾 | `"Run local shell commands from a sidebar tab with live output (e.g. npm run dev, npx vite)."` |
| M2 | `authorUrl` | 指向**个人/组织主页**,非插件仓库 | `"https://github.com/joke-lx"`(不含 `/ob-ps`) |

### 3. README

| # | 标准 | 说明 |
|---|------|------|
| R1 | 必须含英文 | 可以有中文翻译,但首段或 Features 必须有英文描述 |

### 4. CSS

| # | 标准 | 替代方案 |
|---|------|---------|
| C1 | 禁止 `!important` | 使用重复选择器提升特异性,如 `body.cls body.cls .target` |

### 5. Dependencies

| # | 标准 | 说明 |
|---|------|------|
| D1 | `builtin-modules` 改用 `node:module.builtinModules` | 后者是 Node 原生 API,无需依赖包 |
| D2 | 无已知漏洞依赖 | `npm audit` 检查 |

### 6. Behavior(无法消除的 Warning,需在说明中 justify)

| # | 行为 | 说明 |
|---|------|------|
| B1 | Direct Filesystem Access(`fs` 直访) | Local Runner 的核心能力,通过 `child_process.spawn` 运行 shell 命令,必须读写文件系统 |
| B2 | Shell Execution(`child_process`) | 插件的核心功能,无法避免 |

审查报告中将标 Warning,但**可以存在,无需修改**,前提是插件功能定性明确。

### 7. Release Assets

| # | 检查项 | 标准 |
|---|--------|------|
| Z1 | 只含三个文件 | `main.js` + `manifest.json` + `styles.css` |
| Z2 | 不包含 `.claude/skills/`、`node_modules/` 等 | zip 包应干净 |
| Z3 | `main.js` 与 `styles.css` 有 GitHub artifact attestation | 由 CI 的 `actions/attest-build-provenance` 自动保证 |
| Z4 | 无可疑网络请求 | 由审查自动扫描,无法通过代码控制 |

### 8. 完整检查清单

```text
[ ] npm run lint  — 0 errors(0 warnings 可选,但建议消除)
[ ] npm run build — 0 errors(tsc + esbuild)
[ ] E1 — 所有 eslint-disable 带描述
[ ] E2 — 无 obsidianmd/* disable
[ ] E3 — 无 @typescript-eslint/no-deprecated disable
[ ] E4 — 无裸 document 引用
[ ] M1 — description 英文 + 标点结尾
[ ] M2 — authorUrl 为个人主页
[ ] R1 — README 含英文
[ ] C1 — CSS 无 !important
[ ] D1 — 已换 node:module.builtinModules
[ ] D2 — npm audit 无漏洞
[ ] Z1-Z3 — CI 打包正确
```

## 输出格式

检查完成后,用以下格式报告:

```
📋 Obsidian Plugin Review Compliance

✅ Pass: R1, M1, M2, D1, D2, C1, Z1-Z4, B1/B2(justified)
⚠️ Warning: E4 (2 occurrences in src/view/process-form.ts — activeDocument)

💡 Actions
1. Run `npm run lint --fix` for auto-fixable warnings
2. Submit to obsidianmd/obsidian-releases when all ⚠️ cleared
```

## 触发方式

- **自动**:PostToolUse hook 在 `npm run build`、`npm run lint`、`npm run dev` 后触发
- **手动**:输 "检查插件审核标准"、"run review check" 或 `/obsidian-plugin-review`

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| `// eslint-disable-next-line no-deprecated` 不加描述 | Obsidian 审查报 Error: "Unexpected undescribed directive" | 改为用替代 API,彻底移除 disable;或加 `-- <reason>` 描述 |
| `console.log("[prefix] ...")` + disable rule-custom-message | Obsidian 审查禁止禁用 obsidianmd/rule-custom-message | 改用 `console.debug()`(规则不拦截 debug 级别) |
| `document.createElement("option")` | 审查 Warning: popout 窗口不兼容 | 用 `parentEl.createEl("option")` |
| manifest.json `authorUrl` 指向 `https://github.com/joke-lx/ob-ps` | 审查 Warning: authorUrl 不能指向仓库 | 改为 `https://github.com/joke-lx` |
| `moduleResolution: "node"` | TS 7.0 报错 | 改为 `"bundler"` |
| `!important` 在 CSS 中 | 审查 Warning | 用重复选择器提升特异性 |

## 参考

- [Obsidian Plugin Review 指南](https://docs.obsidian.net/Plugins/Releasing/Plugin+review+guidelines)
- [社区插件提交 PR](https://github.com/obsidianmd/obsidian-releases)
