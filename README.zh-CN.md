# Local Runner

**语言：** [English](README.md) · [简体中文](README.zh-CN.md)

在 Obsidian 侧边栏运行本地 shell 命令并实时查看输出，同时内置双链检查与可视化的「完善历史树」。每个命令拥有独立卡片，带状态指示灯与可展开日志——适合边写笔记边常驻 `npm run dev`、`npx vite` 或任意 CLI 工具。

> 仅桌面端可用。插件通过 Node 的 `child_process` 启动子进程，该能力在 Obsidian 移动端沙箱中不可用。

## 功能

### 进程管理
- **多进程并行** —— 同时运行多条命令，各自独立的输出面板。
- **快捷启动栏** —— 设置中定义的每条命令对应一个按钮。单击启动、再次单击停止。状态点指示当前状态：运行中（黄）、异常退出（红）、空闲（灰）。
- **实时流式输出** —— stdout 与 stderr 合流显示，自动剥离 ANSI 转义，缓冲上限 200,000 字符以控制内存占用。
- **分卡片日志** —— 在终端输出区单击卡片可展开或收起日志；支持拖拽卡片重新排序。
- **Windows 感知的进程终止** —— 停止进程时执行 `taskkill /T /F` 杀掉整棵进程树，避免 dev server 继续占用端口；其他平台退化为 `SIGTERM`。

### 双链工具
- **未解析双链列表** —— 侧边栏上半部分列出所有未解析的 `[[ ]]` 双链，按源笔记创建时间由新到旧排列，支持增量「加载更多」。
- **清除未解析双链** —— 橡皮擦按钮在二次确认后将 vault 内所有未解析 `[[x]]` 转为 `[x]`。另有独立命令仅处理当前笔记的双链。
- **进程退出后自动重新扫描** —— 命令组上有一个独立的勾选项「进程退出后自动重新扫描」；勾选后,当该进程以退出码 0 成功结束时,插件会重新扫描「启动该进程时记录的活跃笔记」所属主题的双链树。默认关闭（显式 opt-in),以避免 dev server 等长期进程频繁触发扫描。
- **完善历史树** —— 可拖动、可缩放的画布（侧边栏「双链树」按钮）可视化每次 vault 扫描。先展开双链树 zone，再单击 zone 头的 `list-tree` 图标,即可扫描当前活跃笔记所属主题（沿笔记 frontmatter 的 `bklink` 链向上追溯到首个无 bklink 的节点作为主题根);画布自动高亮当前打开的笔记,单击节点跳转到源笔记。节点折叠状态按主题持久化。
- **高亮双链** —— 可按解析状态为内部双链着色，已解析与未解析颜色均可自定义，且分别支持亮色与暗色主题。

### 数据与持久化
- **跨重启与卸载保留** —— 命令、设置与历史树事件均持久化。开启「卸载插件时保留数据」（默认开启）后，还会把备份写入 vault 内（独立于插件目录），重装时自动恢复。
- **向 vault 安装 Claude skill** —— 可从任意 `degit` 源（例如 `owner/repo/skills/<dir>#main`）安装 skill 到 `<vault>/.claude/skills/<name>`，并在同一处卸载。

## 环境要求
- **仅桌面端。**
- Obsidian **1.7.2** 及以上版本。

## 安装

### 从社区插件市场安装（发布后可用）
1. 设置 → 第三方插件 → 浏览
2. 搜索 **Local Runner**
3. 点击安装，随后启用。

### 从 GitHub Release 手动安装
1. 前往 [Releases 页面](https://github.com/On-DevPlan/ob-ps/releases) 下载最新版。
2. 在 vault 中创建目录 `.obsidian/plugins/local-runner/`。
3. 将 `main.js`、`manifest.json`、`styles.css` 复制进去。
4. 设置 → 第三方插件 → 刷新，随后启用 **Local Runner**。

## 使用

1. **打开侧边栏** —— 命令面板搜索「打开侧边栏」，或点击左侧 ribbon 的播放图标。
2. **添加命令** —— 设置 → Local Runner → **进程命令** tab → **命令组管理** → **＋ 新建**。填写名称、shell 命令，以及可选的工作目录；侧边栏随即出现对应的快捷启动按钮。
3. **启动与停止** —— 单击快捷启动栏中该命令的按钮。
4. **查看日志** —— 单击「日志」按钮展开终端输出区，再单击进程卡片展开其日志。
5. **检查双链** —— 上半部分列出未解析双链。单击橡皮擦可清除 vault 内全部未解析双链；也可通过命令面板仅扁平化当前笔记的双链。
6. **生成双链树** —— 单击工具行的「双链树」按钮展开双链树 zone,再单击 zone 头的 `list-tree` 图标即可扫描当前活跃笔记所属主题,结果以可平移的 canvas 渲染。
7. **查看双链树** —— 拖动平移、滚轮缩放、双击自适应、单击节点跳转到源笔记。

## 设置

设置 → Local Runner 分为 3 个 tab。

### 进程命令 tab
- **卸载插件时保留数据** —— 开启（默认）时，命令与设置会额外备份到 vault，重装自动恢复；关闭会清除已有备份。
- **命令组管理** —— 管理快捷启动命令：名称、命令、工作目录、可见性，以及「进程退出后自动重新扫描」勾选项。

### 双链 tab
- **高亮双链样式** —— 开关内部双链高亮，并在亮色与暗色主题下分别为已解析、未解析双链选择颜色。
- **最新已解析双链数量** —— 侧边栏「最新已解析双链」区块显示的条数（1–50），按目标去重、按源笔记创建时间倒序。
- **双链树数据管理**（默认折叠）—— 按主题根分组的扫描事件统计，每条主题附删除按钮，并提供「清空所有」操作。可用于清理旧版 snapshot 残留或一键清空历史。

### skill tab
- **从远端仓库安装 skill** —— 粘贴 `degit` 源（`owner/repo/skills/<dir>#<ref>`）即可将 skill 安装到 vault 的 `.claude/skills/`；通过每行末尾的按钮卸载已安装的 skill。

## 命令
- **打开侧边栏** —— 显示 Local Runner 面板。
- **打开设置** —— 直接跳转到本插件的设置页。
- **将当前笔记的双链转为单链** —— 将当前笔记中所有 `[[link]]` 转为 `[link]`。

## 安全提示
- 命令通过 `child_process.spawn`（`shell: true`）执行，等价于在终端中手动输入，支持管道、参数等任意 shell 语法。
- **不要** 用本插件运行来历不明的命令或解析未受信任的输入。
- 默认工作目录为 vault 根目录；子进程继承 Obsidian 的环境变量。
- Windows 上停止进程会杀掉整棵进程树；其他平台仅向直接子进程发送 `SIGTERM`。

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 监听模式：改动后自动重建并同步到 vault
npm run build        # 类型检查 + 生产构建（产物为根目录下的 main.js）
npm run lint         # eslint 静态检查
npm test             # 运行一次 vitest 全量测试
npm run test:watch   # vitest 监听模式
```

dev 模式会将 `main.js`、`manifest.json`、`styles.css` 同步到 vault 插件目录以便热加载。可用环境变量覆盖目标位置：

```bash
LOCAL_RUNNER_VAULT=/path/to/vault/.obsidian/plugins/local-runner npm run dev
```

生产构建仅输出到源码根目录，发布打包由 CI 完成。

## 发布流程

发布已自动化。每次推送到 `main` 会触发 GitHub Actions：

1. 递增 `manifest.json` 的 patch 版本，并在 `versions.json` 追加对应映射条目。
2. 类型检查并构建。
3. 打包 `local-runner-<version>.zip`，内含 `main.js`、`manifest.json`、`styles.css`。
4. 为构建产物签署来源证明（build provenance）。
5. 以 `[skip ci]` 提交版本号、打 tag、发布 GitHub Release。

日常开发只需 `git push origin main`。提交到 Obsidian 社区市场是独立步骤：需向 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提交 PR，在 `community-plugins.json` 中新增一条记录。

## 许可

ISC —— 详见 [LICENSE](LICENSE)。
