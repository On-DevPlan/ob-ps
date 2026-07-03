# 双链树 Hook 技术架构

> ob-ps 插件中，未解析双链的可视化与生命周期管理。

## 1. 目标

让用户**看到一张能演化的双链树**：

- 启动 `snapshotEnabled` 的进程 → 拍一次双链快照，树出现
- 进程运行中，Obsidian 解析链接 → 树节点从「待完善」变「已创建」
- 进程退出 → 监听结束，树保留最终状态

**核心约束**：不引入常驻监听器；多个并发进程共享一个监听器；监听器生命周期严格绑进程。

---

## 2. 总体架构（Event Sourcing + Hook）

### 2.1 三层模型

```
┌─────────────────────────────────────────────────┐
│  进程生命周期（ProcessLifecycle）                 │
│  启/停/退出 → 触发 snapshot hook                 │
└─────────────────────────────────────────────────┘
                       ↓ snapshot + 注册监听
┌─────────────────────────────────────────────────┐
│  事件日志（Event Log, 持久化）                    │
│  PluginData.linkTree.events: CreationEvent[]   │
└─────────────────────────────────────────────────┘
                       ↓ 读时投影
┌─────────────────────────────────────────────────┐
│  树形投影（Tree Projection, 内存只读）            │
│  渲染 / 状态 / 布局 / Canvas 绘制                │
└─────────────────────────────────────────────────┘
```

### 2.2 模块边界

| 模块 | 职责 |
|---|---|
| `creation-event.ts` | 不可变事件类型 + normalize 工具 |
| `creation-tracker.ts` | `capture()`：rows + dedup → 新事件 |
| `link-tree-repository.ts` | `loadEvents` / `appendEvents` 读写 `PluginData.linkTree` |
| `snapshot-hook.ts` | `trackSnapshot(host, runId)` 一次性捕获包装 |
| `tree-projector.ts` | `projectTree(events, deps)` 纯函数推导树 |
| `tree-layout.ts` | `layoutTree(roots)` 计算坐标 |
| `canvas-renderer.ts` | Canvas 2D 绘制 |
| `link-tree-canvas.ts` | 输入交互（pointer / wheel / dblclick）+ 视口 |
| `link-tree-view.ts` | 桥接层：mount / update / 折叠 / 作用域过滤 |

---

## 3. Hook 设计：引用计数 + 单监听器

### 3.1 触发点

`cg-card-row is-check`（命令组设置页的「启动时拍双链快照」checkbox）：

```
CommandGroup.snapshotEnabled
    ↓
ProcessConfig.snapshotEnabled
    ↓
RunnerTab.snapshotEnabled
    ↓
启动时 → onProcessStart → trackSnapshot + _incSnapshotRef
退出时 → onProcChange(status) → _decSnapshotRef
```

### 3.2 为什么是引用计数

直觉：每个进程注册自己的监听器。问题：N 个 concurrent 进程 → N 个完全相同的回调 → N 次 `treeView.updateFromApp()`。

**更优雅的方案**：refCount 守卫单监听器。

```typescript
// refCount 状态
_snapshotRefCount = 0;
_snapshotEventRef = null;       // 唯一的 EventRef
_snapshotActiveTabs = Set<id>(); // 幂等：同一 tab 不重复计数

// 注册（start）
_incSnapshotRef(tabId, tabName) {
  if (tabId 已在 set) return;       // 幂等
  set.add(tabId);
  refCount++;
  if (refCount === 1) {
    注册唯一的 metadataCache.on("resolved", cb);  // 单例
  }
  console.debug(`[snapshot] 进程「${tabName}」启动 (refCount=${refCount})`);
}

// 注销（exit）
_decSnapshotRef(tabId, tabName) {
  if (tabId 不在 set) return;       // 幂等
  set.delete(tabId);
  refCount--;
  if (refCount === 0) {
    metadataCache.offref(eventRef);  // 真正注销
    eventRef = null;
  }
  console.debug(`[snapshot] 进程「${tabName}」退出 (refCount=${refCount})`);
}
```

**关键性质**：

| 性质 | 实现 |
|---|---|
| 单监听器 | `refCount === 1` 时才注册 |
| 多进程并发 | 多个 tabId 同时在 set 中，监听器仍只有一份 |
| 幂等退出 | `onChange("status")` 可能多次触发，但 set 保证只 decrement 一次 |
| view 关闭兜底 | `onClose()` 显式 `offref` 残留监听器 |
| 进程 spawn 失败 | `startProcess` 同步失败 → `onProcChange` 立即 decrement，net zero |

### 3.3 监听器回调做什么

```typescript
const cb = () => {
  const activePath = this.getActiveNotePath();
  this.treeView.updateFromApp(
    this.opts.getLinkTreeEvents(),
    this.app,
    activePath
  );
};
```

**只重新投影树，不触发 WLI 列表刷新**。WLI 列表（未解析双链的滚动列表）与树是不同关注点：WLI 是 vault 全局扫描的副作用，树是本次快照的演化展示。

---

## 4. 事件日志（事实层）

### 4.1 CreationEvent

```typescript
interface CreationEvent {
  id: string;            // 稳定 id（DOM key / dedup）
  target: string;        // 未解析双链的目标笔记名
  sourcePath: string;    // 触发该 [[]] 的源文件
  position: { line: number; col: number };
  firstSeenAt: number;   // 首次捕获时间戳
  runId: string;         // 批次标识 = ${tab.id}_${Date.now()}
}
```

**不可变 + append-only + 无派生状态**。

### 4.2 持久化

```
PluginData = {
  processes: ProcessConfig[],
  settings: PluginSettings,
  linkTree?: { events: CreationEvent[], version: number }
}
```

`appendEvents()` 不可变追加（新数组，旧数组保持不动），避免意外 mutate。

### 4.3 runId 唯一性

每次进程启动生成 `${tab.id}_${Date.now()}`。**只是溯源 tag，不影响显示过滤**——`runId` 写入事件但树不按 runId 分组。

---

## 5. 树投影（派生层）

### 5.1 `projectTree(events, deps)`

**纯函数**。O(E) 复杂度，与 vault 全量链接数 R 无关。

```typescript
function projectTree(events, deps): TreeNode[] {
  // 1. 按 normalizedTarget 索引，同 target 取 firstSeenAt 最新
  // 2. 按 firstSeenAt 升序遍历，parent 在 nodeMap 中则挂载为子节点
  //    parent 不存在 → 根节点（打破循环）
  // 3. 递归 annotate：status（O(1) cache 查询）+ isStale + depth
}
```

### 5.2 `ProjectDeps` 注入

```typescript
interface ProjectDeps {
  isResolved: (target, sourcePath) => boolean;
  sourceExists: (sourcePath) => boolean;
}

function makeProjectDeps(app: App): ProjectDeps {
  return {
    isResolved: (t, src) => !!app.metadataCache.getFirstLinkpathDest(t, src),
    sourceExists: (src) => !!app.vault.getAbstractFileByPath(src),
  };
}
```

**关键**：`status` 永远**实时查询**，从不缓存。

> 用户建完笔记 → Obsidian 内部解析 → `getFirstLinkpathDest()` 返回 TFile → `status = "created"` → 树重投影 → 节点变色。

---

## 6. UI 交互层

### 6.1 渲染管线

```
events → projectTree → TreeNode[] → layoutTree → LayoutNode[] → canvas 绘制
```

- `tree-layout.ts`：算 x/y/w/h/depth/descendantCount/hasChildren
- `canvas-renderer.ts`：节点色（pending/created/isStale）、连线、ghost 节点
- `link-tree-canvas.ts`：视口（zoom/pan/fit）、pointer 交互、点击跳转

### 6.2 作用域过滤

树显示**当前打开页面相关的整棵树**：

```
filterByActiveNote(events, activeNotePath)
  → 仅保留 firstSeg(sourcePath) === firstSeg(activeNotePath) 的事件
```

切换笔记 → `active-leaf-change` 监听器 → 重新投影（**这个监听器常驻，不绑进程**）。

### 6.3 跳转

点击节点 → `onJump(event)` → `openSource({ sourcePath, position })` → Obsidian 打开对应文件并定位光标。

---

## 7. 边界情况

| 场景 | 行为 |
|---|---|
| 进程 spawn 失败 | refCount: 0→1→0，监听器注册即注销，无残留 |
| 进程极快退出（< 100ms） | 同上，幂等 set 保证只 decrement 一次 |
| 用户手动 stop | `stopProcess` → `onChange("status")` → decrement |
| 进程 crash | `child.on("error")` → status="exited-err" → decrement |
| 多进程并发 | refCount 累加，监听器复用 |
| view 关闭时仍有进程 | `onClose()` 先 `offref` 监听器，再 `stopProcess` 所有 tab |
| snapshot 失败（try/catch） | 进程仍启动，仍注册监听器（让现有 pending 事件也能转 created） |
| `startOrCreateTab` 路径（非 await） | `void onProcessStart`，fire-and-forget；监听器立即注册 |

---

## 8. 关键文件

| 文件 | 行数级 | 职责 |
|---|---|---|
| `src/link-tree/creation-event.ts` | ~60 | 事件类型 + normalize |
| `src/link-tree/creation-tracker.ts` | ~75 | capture 纯函数 |
| `src/link-tree/link-tree-repository.ts` | ~50 | 持久化读写 |
| `src/link-tree/snapshot-hook.ts` | ~45 | trackSnapshot 一次性捕获 |
| `src/link-tree/tree-projector.ts` | ~140 | 事件 → TreeNode 投影 |
| `src/link-tree/tree-layout.ts` | ~120 | 坐标布局 |
| `src/link-tree/canvas-renderer.ts` | ~250 | Canvas 2D 绘制 |
| `src/link-tree/viewport.ts` | ~50 | 视口变换 |
| `src/link-tree/link-tree-canvas.ts` | ~345 | 交互 + 视口 + 动画 |
| `src/link-tree/link-tree-view.ts` | ~145 | 桥接 + 过滤 + 折叠 |
| `src/view/merged-view.ts` | — | `_inc/_decSnapshotRef` 引用计数 + 调用 `treeView` |

---

## 9. 设计要点回顾

1. **持久化只存事实（事件），不存状态（pending/created）**。状态靠 Obsidian cache 实时查询推导。
2. **监听器不常驻**，由 refCount 守卫。N 个进程 → 1 个监听器。
3. **runId 只是溯源 tag**，不影响显示过滤。树的范围由「当前打开页面」决定。
4. **snapshotEnabled checkbox** 是唯一开关：决定是否拍快照 + 是否启动监听。
5. **进程退出 = 监听器退出**。生命周期严格对称。
6. **状态实时查**。每次投影都重新 query metadataCache，没有缓存过期问题。