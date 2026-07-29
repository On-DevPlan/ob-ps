# Project Index: obsidian-local-runner (ob-ps)

Generated: 2026-07-29

## 📁 Project Structure

```
ob-ps/
├── main.ts                          # 插件入口:LocalRunnerPlugin 编排
├── esbuild.config.mjs               # 打包脚本,dev/watch + 同步到 vault
├── manifest.json                    # Obsidian 插件清单 (id=local-runner, v1.0.30)
├── package.json                     # ESM, scripts: dev/build/lint/test/test:watch
├── tsconfig.json                    # ESNext + bundler, strict, lib DOM/ES2018
├── styles.css                       # 双链高亮 + UI 样式
├── versions.json                    # 版本 → minAppVersion 映射
├── .github/workflows/
│   ├── lint.yml                     # Node 20/22 矩阵,npm ci + build + lint
│   └── release.yml                  # 自动 bump patch,zip + gh release(commit [skip ci])
├── eslint.config.js                 # 继承 obsidianmd 规则集
├── src/
│   ├── obsidian-globals.d.ts        # 类型补丁(obsidian 私有 API)
│   ├── runner.ts                    # runner 公共聚合导出(legacy 路径兼容)
│   ├── view.ts                      # view 公共聚合导出
│   ├── runner/                      # 进程生命周期、buffer、ANSI、exit-code
│   ├── view/                        # merged view、process-item、process-form、tree zone
│   ├── settings-tab/                # 设置页 sections + tabs + 迁移
│   ├── wikilink-inspector/          # 双链检查器:扁平化/未解析清理/源/行
│   ├── wikilink/                    # 高亮(applyWikilinkStyle)
│   ├── link-tree/                   # 双链树:repo/scanner/topic/graph/canvas
│   ├── skills/                      # 内置 skills 安装 + 行渲染
│   ├── backup/                      # data-backup(卸载保留)
│   └── types/                       # ProcessConfig / PluginSettings / commands
└── tests: 23 .test.ts(就近放在各模块下, vitest run)
```

## 🚀 Entry Points

| 角色 | 路径 | 说明 |
|------|------|------|
| 插件主类 | `main.ts` | `LocalRunnerPlugin extends Plugin`,onload/onunload + 持久化 + 通知 view |
| 打包入口 | `esbuild.config.mjs` → `main.ts` | dev 模式 watch + 同步 `123/.obsidian/plugins/local-runner/`;`--production` 一次性出包 |
| 测试入口 | `vitest run`(默认根目录) | 23 个就近 `.test.ts`,覆盖 runner/process-host, settings-tab/sections, link-tree, wikilink-inspector, skills |
| Lint | `eslint .` | 含 obsidianmd 规则,验证 manifest |
| 视图类型 | `MERGED_VIEW_TYPE` = `"local-runner-merged-view"`(`src/view/merged-view.ts`) | 侧边栏主视图 |

## 📦 Core Modules

### `main.ts` (LocalRunnerPlugin)
- 编排: 加载数据 → schema 迁移 v1→v2 → 备份恢复 → 设置迁移 → reconciling installedFlag → 高亮 → 设置页 → 合并视图 → ribbon/命令
- 公开方法: `openSettings / activateView / saveSettings / getDefaultCwd / onTreeScanClicked / removeLinkTreeTopic / clearAllLinkTreeEvents / listLinkTreeTopics / setLinkTreeCollapsed / getLinkTreeCollapsed / notifyCommandGroupsChanged / notifyResolvedLimitChanged / notifyLinkTreeChanged / applyWikilinkStyle`
- 数据形状(`PluginData`): `schemaVersion / processes*(legacy) / settings / linkTree / linkTreeCollapsed`

### `src/runner/` — 进程运行时
- `process-model.ts` — `RunnerStatus / RunnerTab / isRunning`
- `process-factory.ts` — `createTab`
- `process-host.ts` — `RunnerHost / resolveOrCreateTab`
- `process-lifecycle.ts` — `startProcess / stopProcess / ProcChangeKind`
- `process-launch.ts` — `launchProcess / pickFirstVisibleGroup / LaunchDeps`
- `output-buffer.ts` — `appendOutput / MAX_OUTPUT_CHARS`
- `ansi.ts` — `stripAnsi`
- `exit-code.ts` — `isSuccessExit`

### `src/view/` — 侧边栏 UI
- `merged-view.ts` — `MergedRunnerInspectorView` 主视图(运行区 + 树区 + 设置按钮 + 最近解析双链)
- `process-item.ts` — 进程列表项渲染 + 状态/输出更新
- `process-form.ts` — 新建/编辑表单
- `confirm-modal.ts` — 二次确认弹窗
- `tree-zone-body.ts` / `tree-zone-visibility.ts` — 双链树可视区域
- `index.ts` — 公共聚合导出(向后兼容 `view` 单文件路径)

### `src/settings-tab/` — 设置页
- `index.ts` — `LocalRunnerSettingTab` 聚合;tabs 防抖 500ms 落盘
- `tabs.ts` — `SettingsTabId / TAB_ORDER / TAB_LABEL / normalizeActiveTab`
- `section-skills.ts` — 内置 skills 行;`reconcileInstalledFlag` 同步磁盘
- `section-wikilink.ts` — 高亮开关 + 4 个前景色 picker
- `section-keep-data.ts` — 卸载保留开关
- `section-resolved-recent.ts` — `resolvedRecentLimit`
- `section-command-groups.ts` — 快速按钮组编辑
- `section-link-tree.ts` — linkTree 主题列表 + 清理
- `migrate-command-groups.ts` — 旧"一组多预设" → 新"一组一命令"

### `src/link-tree/` — 双链树
- `vault-scanner.ts` — `scanActiveNoteTopic / removeEventsByTopicRoot`
- `topic-resolver.ts` — `buildBklinkGraph / findTopicRoot`
- `creation-event.ts` / `link-tree-repository.ts` — 事件模型与持久化(load/appendEvents)
- `tree-layout.ts` / `tree-projector.ts` / `viewport.ts` / `canvas-renderer.ts` — 几何与画布
- `link-tree-canvas.ts` / `link-tree-view.ts` — 渲染层

### `src/wikilink-inspector/` — 双链检查
- `inspector-modal.ts` + `inspector-render.ts` — 主面板
- `link-collector.ts` + `link-source.ts` + `link-row.ts` — 解析与行
- `flatten-links.ts` — `flattenWikilinks(editor)`:双链 → 单链
- `clear-unresolved.ts` + `clear-unresolved-modal.ts` — 批量清理未解析双链

### `src/wikilink/highlight.ts` — 双链高亮样式注入(theme-dark 切换会重新注入)

### `src/skills/installer.ts` — 内置 skills 安装/卸载,`InstalledSkill`

### `src/backup/data-backup.ts` — `writeDataBackup / restoreDataBackup / removeDataBackup / BackupPayload`

### `src/types/`
- `settings.ts` — `PluginSettings / DEFAULT_SETTINGS / DEFAULT_FG_VALUES`
- `process.ts` — `ProcessConfig { id, name, command, cwd }`
- `commands.ts` — `CommandGroup`

## 🔧 Configuration

| 文件 | 用途 |
|------|------|
| `manifest.json` | Obsidian 插件清单(minAppVersion=1.7.2,isDesktopOnly) |
| `package.json` | ESM 项目,scripts: dev/build/lint/test/test:watch |
| `tsconfig.json` | `module: ESNext`、`moduleResolution: bundler`、strict |
| `esbuild.config.mjs` | entry=main.ts、format=cjs、target=es2018、外部:obsidian+codemirror+electron+builtin;`LOCAL_RUNNER_VAULT` 覆盖同步路径 |
| `eslint.config.js` | obsidianmd 规则集 |
| `versions.json` | 已发布版本 → minAppVersion 映射 |
| `styles.css` | 双链前景色 fallback + UI 样式 |
| `.github/workflows/lint.yml` | Node 20/22 矩阵 lint+build |
| `.github/workflows/release.yml` | main push 自动 bump patch + zip + `gh release create` |

## 📚 Documentation

- 项目根暂无 README/CHANGELOG(均依赖 GitHub release notes 自动生成)

## 🧪 Test Coverage

- 测试框架: vitest 2.x(单测,jsdom + @types/jsdom)
- 23 个 `.test.ts` 文件,就近放在模块下
- 覆盖重点: `runner/process-host` / `runner/process-launch` / `settings-tab/sections` / `link-tree/{vault-scanner, topic-resolver, refresh-link-tree, tree-layout, tree-projector}` / `wikilink-inspector/*` / `wikilink/highlight` / `skills/{installer, skill-row}`
- 验证命令: `npm run test`(单次)、`npm run test:watch`(watch)

## 🔗 Key Dependencies(devDependencies)

| 包 | 版本 | 用途 |
|----|------|------|
| obsidian | ^1.4.16 | 插件宿主 API(运行时由 Obsidian 注入) |
| esbuild | ^0.23.0 | 打包 |
| typescript | ^5.5.3 | 类型检查 |
| vitest | ^2.1.9 | 单测 |
| jsdom + @types/jsdom | ^29 / ^28 | DOM 测试环境 |
| eslint + typescript-eslint | ^9.39 / ^8.59 | 静态检查 |
| eslint-plugin-obsidianmd | ^0.3.0 | Obsidian 插件规则 |
| @types/node | ^20.14.10 | Node 类型 |

External(运行时由 Obsidian 注入,不打入): `obsidian / electron / @codemirror/* / @lezer/*`

## 📝 Quick Start

1. **安装**: `npm ci`
2. **开发(watch)**: `npm run dev` — 增量打包 + 同步到 `../123/.obsidian/plugins/local-runner/`
3. **生产构建**: `npm run build` — `tsc --noEmit` + esbuild `--production`
4. **静态检查**: `npm run lint`
5. **单测**: `npm run test` / `npm run test:watch`
6. **覆盖 vault 路径**: `LOCAL_RUNNER_VAULT=/path/to/vault npm run dev`

## 📝 关键决策/约束(阅读锚点)

- **仅桌面端**: `manifest.json:isDesktopOnly=true`;依赖 `child_process`(Electron 后端)
- **持久化 schema 版本**: `CURRENT_SCHEMA_VERSION=2`,旧数据走 `migrateV1ToV2`(删 legacy `processes` 字段)
- **卸载保留**: 通过 vault 内备份文件,默认 `keepDataOnUninstall=true`
- **构建同步**: `esbuild` onEnd 钩子自动拷贝到 vault 插件目录(Windows 默认生效,其他平台需 `LOCAL_RUNNER_VAULT`)
- **CI release**: 仅 main push、bump patch、zip 内含 `main.js + manifest.json + styles.css`,`attest-build-provenance` 加溯源,提交信息含 `[skip ci]` 防循环