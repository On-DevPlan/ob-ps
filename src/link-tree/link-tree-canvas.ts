/**
 * link-tree-canvas.ts — 画布组件
 *
 * 自包含：管理 canvas、viewport、投影→布局→绘制管线、输入事件。
 * 外部只需 mount(container, callbacks) 和 update(events, deps)。
 */

import { CanvasRenderer, type DrawNode, type DrawEdge } from "./canvas-renderer";
import { defaultViewport, zoomAt, pan, screenToWorld, type Viewport } from "./viewport";
import { layoutTree, type LayoutNode } from "./tree-layout";
import { projectTree, type TreeNode, type ProjectDeps } from "./tree-projector";
import type { CreationEvent } from "./creation-event";

// ---- 序列化(导出) ----

/** serializeTreeToText 的输入 —— 与 canvas 内部状态对齐 */
export interface SerializeInput {
  /** 已被 canvas 拆分为 ghost + bare 的 layoutRoot 列表(可直接复用) */
  layoutRoots: LayoutNode[];
  /** 当前活跃主题根,用于 header。无则为 "untitled" */
  topicRoot: string | null;
}

/**
 * 把 layoutRoots 序列化为缩进树状文本(可粘贴到对话/笔记)。
 *
 * 格式:
 *   主题: <topicRoot>
 *
 *   📁 <dir>(ghost 节点,代表一个 sourcePath)
 *     - <child>...
 *   📁 <dir2>
 *     - ...
 *   - <bare root>(无 ghost 包裹的普通根)
 *     - <child>...
 *
 * - ghost 节点的 label 与 canvas 渲染一致: `id.split("/").pop()`(取最后一段)。
 * - 普通节点用 `-` 前缀 + 2 空格/层缩进。
 * - 折叠节点(id 在某棵子树里但 children 被折叠)末尾追加 `(N)`,N 为其子孙总数。
 * - layoutRoot 之间空一行,便于肉眼扫。
 */
export function serializeTreeToText(input: SerializeInput): string {
  const { layoutRoots, topicRoot } = input;
  const header = `主题: ${topicRoot ?? "untitled"}`;
  if (layoutRoots.length === 0) {
    return header + "\n\n(空)";
  }
  const blocks: string[] = [];
  for (const root of layoutRoots) {
    blocks.push(renderNode(root, 0, /*isGhostContext=*/ true));
  }
  // blocks 之间用空行分隔,便于肉眼扫
  return [header, "", blocks.join("\n\n")].join("\n") + "\n";
}

/** 渲染一个节点。isGhostContext 决定第一行用 📁 还是 - 前缀。 */
function renderNode(node: LayoutNode, depth: number, isGhostContext: boolean): string {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  // 2026-08 id 化修复:ghost layoutRoot 的 id 形如 "ghost:前端/前端.md",
  // 其余裸 root / children 的 id 形如 "前端/工程化.md"(完整路径)。
  // 用 isGhostNode 统一判定,而非 `node.id.includes("/")` —— 因为裸 root 也可能含 `/`。
  const isGhost = isGhostContext && depth === 0 && isGhostNode(node);
  const rawId = node.id.startsWith("ghost:") ? node.id.slice("ghost:".length) : node.id;
  const label = isGhost ? `📁 ${basenameOfId(rawId)}` : basenameOfId(rawId);
  const prefix = isGhost ? "" : "- ";
  let line = `${indent}${prefix}${label}`;
  if (node.collapsed && node.children.length > 0) {
    const total = countDescendants(node);
    line += ` (${total})`;
  }
  lines.push(line);
  if (!node.collapsed) {
    for (const child of node.children) {
      lines.push(renderNode(child, depth + 1, false));
    }
  }
  return lines.join("\n");
}

/** 递归统计折叠子树的总节点数(含 children 自身) */
function countDescendants(node: LayoutNode): number {
  let n = node.children.length;
  for (const c of node.children) n += countDescendants(c);
  return n;
}

/**
 * 从 node id(完整路径,如 "前端/工程化.md")提取 display basename(如 "工程化")。
 * 2026-08 id 化修复后所有 LayoutNode.id 都用完整路径,
 * 此函数统一剥 `.md` 后缀作为 UI 显示。
 */
function basenameOfId(id: string): string {
  const last = id.split("/").pop() || id;
  return last.replace(/\.md$/i, "");
}

/**
 * 判定 LayoutNode 是否是 ghost(代表某个 sourcePath 的 wrapper)。
 * 优先级:显式 `isGhost` flag > id 前缀 > `/` 启发式(测试兼容)。
 * 2026-08 id 化修复后,生产代码永远设 isGhost=true / 用 `ghost:` 前缀;
 * `/` 启发式仅作旧测试 helper 的回退。
 */
function isGhostNode(node: LayoutNode): boolean {
  if (node.isGhost === true) return true;
  if (node.id.startsWith("ghost:")) return true;
  return node.id.includes("/");
}

/**
 * 把 layoutRoots 序列化为 Mermaid 引用块(graph TD),可粘到任何 .md 直接渲染。
 *
 * 形状:
 *   ```mermaid
 *   %% topic: <topicRoot>
 *   graph TD
 *     n0["📁 前端.md"]
 *     n0 --> n1["工程化"]
 *     n1 --> n2["性能优化"]
 *     n2 --> n3["RUM"]
 *   ```
 *
 * 设计要点:
 * - mermaid id 用 `n` + 自增序号(`n0`/`n1`/...)保证唯一,即使同名节点也不冲突
 * - label 用 `["..."]` 包裹,内容需转义 `"` 和 `\`
 * - ghost 节点用 `📁` 前缀(label 一致,与文字版/canvas 渲染对齐)
 * - 顶部 `%% topic: ...` 注释 —— mermaid 注释不渲染,源码可读
 * - 折叠节点的子节点不输出(避免冗余)
 *
 * 适用场景:粘到 .md 直接看到树形图;无需 Excel/dataview,所有支持 mermaid 的
 * 渲染器(Obsidian / GitHub / GitLab / VSCode preview)都直接生效。
 */
export function serializeTreeToMermaid(input: SerializeInput): string {
  const { layoutRoots, topicRoot } = input;
  const out: string[] = ["```mermaid"];
  out.push(`%% topic: ${topicRoot ?? "untitled"}`);
  out.push("graph TD");
  let counter = 0;
  const idMap = new WeakMap<LayoutNode, string>();

  const allocate = (node: LayoutNode): string => {
    const id = `n${counter++}`;
    idMap.set(node, id);
    return id;
  };

  for (const root of layoutRoots) {
    walkMermaid(root, true, out, idMap, allocate);
  }
  out.push("```");
  return out.join("\n") + "\n";
}

/** 递归:输出每个节点的定义行 + 与父的边。 */
function walkMermaid(
  node: LayoutNode,
  isGhostContext: boolean,
  out: string[],
  idMap: WeakMap<LayoutNode, string>,
  allocate: (n: LayoutNode) => string,
): void {
  const myId = idMap.get(node) ?? allocate(node);
  // 2026-08 id 化修复:用 isGhostNode() 精确判定,避免 bare root 也被加 📁 前缀。
  const isGhost = isGhostContext && isGhostNode(node);
  const rawId = node.id.startsWith("ghost:") ? node.id.slice("ghost:".length) : node.id;
  const label = isGhost ? `📁 ${basenameOfId(rawId)}` : basenameOfId(rawId);
  out.push(`  ${myId}["${escapeMermaidLabel(label)}"]`);

  if (node.collapsed) return;

  for (const child of node.children) {
    const childId = allocate(child);
    out.push(`  ${myId} --> ${childId}`);
    // 子递归用 isGhostContext=false(子节点永远不是 layoutRoot 包装层)
    walkMermaid(child, false, out, idMap, allocate);
  }
}

/** Mermaid label 内必须转义:双引号、反斜杠。括号通常安全但有特殊字符时建议。 */
function escapeMermaidLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface CanvasCallbacks {
  onJump(event: CreationEvent): void;
  onCollapseChange?(collapsed: Set<string>): void;
}

const I_R = 9, I_DX = 13;

export class LinkTreeCanvas {
  private canvas!: HTMLCanvasElement;
  private renderer!: CanvasRenderer;
  private vp: Viewport = defaultViewport();
  private collapsed: Set<string> = new Set();
  private cb: CanvasCallbacks | null = null;

  // 当前绘制数据
  private nodes: DrawNode[] = [];
  private edges: DrawEdge[] = [];
  private layoutMap = new Map<string, { x: number; y: number; w: number; h: number; hasC: boolean; hid: string | null }>();
  private evMap = new Map<string, CreationEvent>();
  private hoverId: string | null = null;
  private clickedId: string | null = null;
  private activeId: string | null = null;
  private firstUpdate = true;
  // 最近一次 update 后的 layout 快照 —— 给导出按钮复用
  private currentLayoutRoots: LayoutNode[] = [];
  private currentTopicRoot: string | null = null;

  // 平滑动画
  private animRaf: number | null = null;

  // 拖拽状态
  private drag = false;
  private moved = false;
  private p0: [number, number] = [0, 0];
  private pL: [number, number] = [0, 0];

  mount(container: HTMLElement, cb: CanvasCallbacks): void {
    this.cb = cb;
    this.canvas = activeDocument.createElement("canvas");
    // CSS 类管理样式,避免 obsidianmd/no-static-styles-assignment
    this.canvas.className = "link-tree-canvas";
    container.appendChild(this.canvas);
    console.debug("[scan] LinkTreeCanvas.mount, container size =",
      container.clientWidth, "x", container.clientHeight);
    this.renderer = new CanvasRenderer(this.canvas.getContext("2d")!);
    this.bindEvents();
    window.addEventListener("resize", this._rs);
    try {
      this._ro = new ResizeObserver(() => {
        console.debug("[scan] ResizeObserver fired, canvas size =",
          this.canvas.clientWidth, "x", this.canvas.clientHeight,
          "firstUpdate=", this.firstUpdate, "nodes=", this.nodes.length);
        if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0 && !this.firstUpdate) {
          this.fit();
          if (this.activeId && this.layoutMap.has(this.activeId)) {
            this._animatePanTo(this.activeId);
          }
        }
        this._rf();
      });
      this._ro.observe(this.canvas);
    } catch { /* 兼容性 fallback — window.resize 兜底 */ }
  }

  update(
    events: CreationEvent[],
    deps: ProjectDeps,
    activeNoteTarget?: string | null,
    topicRoot?: string | null,
  ): void {
    console.debug("[scan] LinkTreeCanvas.update enter, events=", events.length);
    this.evMap.clear();
    // 2026-08 id 化修复:evMap 按 targetPath(完整路径)做 key,不再按 target basename。
    // 解决 vault 中两个同名文件 evMap 后写覆盖前写、点击跳错文件的 bug。
    for (const e of events) this.evMap.set(e.targetPath, e);

    const treeRoots = projectTree(events, deps);
    console.debug("[scan] projectTree returned", treeRoots.length, "roots");

    // 建 LayoutNode 森林：带 ghost origin
    const ghostMap = new Map<string, TreeNode[]>();
    const bare: TreeNode[] = [];
    for (const r of treeRoots) {
      const sp = r.event.sourcePath;
      if (r.isStale || !sp.includes("/")) { bare.push(r); continue; }
      const arr = ghostMap.get(sp) ?? [];
      arr.push(r);
      ghostMap.set(sp, arr);
    }
    // 2026-08 id 化修复:ghostChildSet 用 targetPath(完整路径)做 key,
    // 避免两个同名 child event 互相覆盖。
    const ghostChildSet = new Set<string>();
    const layoutRoots: LayoutNode[] = [];
    for (const [sp, subs] of ghostMap) {
      for (const s of subs) ghostChildSet.add(s.event.targetPath);
      // ghost layoutRoot id 加 "ghost:" 前缀,确保与 bare root(targetPath 完整路径)
      // 永远不会撞 id —— 即使某文件既是 ghost 父又是 child 自身的 bare root。
      layoutRoots.push({
        id: "ghost:" + sp,
        children: subs.map(t => this._tl(t)),
        collapsed: this.collapsed.has(sp),
        isGhost: true,
      });
    }
    for (const r of bare) {
      if (!ghostChildSet.has(r.event.targetPath)) {
        layoutRoots.push(this._tl(r));
      }
    }

    // 布局
    const layout = layoutTree(layoutRoots);

    // 构建绘制数据
    const la = this.layoutMap;
    la.clear();
    const nd: DrawNode[] = [];
    const ed: DrawEdge[] = [];
    // ghostIds:由 "ghost:" 前缀判定。不能用 id.includes("/") —— 修复后 bare root
    // 的 id 也是完整路径(也含 "/"),会误判。
    const ghostIds = new Set(layoutRoots.filter(r => r.id.startsWith("ghost:")).map(r => r.id));

    const walk = (n: LayoutNode): void => {
      const pos = layout.nodes.get(n.id);
      if (!pos) return;
      la.set(n.id, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, hasC: pos.hasChildren, hid: ghostIds.has(n.id) ? this.canvas?.id ?? null : null });

      const isGhost = ghostIds.has(n.id);
      // 2026-08 id 化:LayoutNode.id = targetPath(完整路径)或 "ghost:" + sourcePath。
      // evMap 按 targetPath key,ghost lookup 必然 miss(没 ghost 对应事件) → 走 fallback。
      const evLookupId = isGhost ? n.id.slice("ghost:".length) : n.id;
      const ev = this.evMap.get(evLookupId);
      const rawId = isGhost ? n.id.slice("ghost:".length) : n.id;
      // label 统一:basename(剥 .md 后缀,确保 UI 不出现 "工程化.md")
      const displayLabel = basenameOfId(rawId);

      nd.push({
        id: n.id,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        label: displayLabel,
        isGhost, isStale: ev ? !deps.sourceExists(ev.sourcePath) : false,
        isCreated: ev ? deps.isResolved(ev.target, ev.sourcePath) : true,
        depth: pos.depth, hasChildren: pos.hasChildren,
        collapsed: pos.collapsed,
        descendantCount: pos.descendantCount,
      });

      for (const c of n.children) {
        const cp = layout.nodes.get(c.id);
        if (!cp) continue;
        ed.push({ x1: pos.x + pos.w, y1: pos.y + pos.h / 2, x2: cp.x, y2: cp.y + cp.h / 2, isGhost });
      }
      n.children.forEach(walk);
    }

    for (const r of layoutRoots) walk(r);

    this.nodes = nd;
    this.edges = ed;
    console.debug("[scan] LinkTreeCanvas.update built", nd.length, "nodes", ed.length, "edges");

    // 更新 activeId（当前打开的笔记 → 高亮节点）
    const newActive = activeNoteTarget ?? null;
    const activeChanged = newActive !== this.activeId;
    this.activeId = newActive;

    // Defer the firstUpdate "fit + center" until the canvas actually has
    // a non-zero size. The container may still be 0×0 if the tree zone is
    // collapsed at the time update() runs (e.g. right after a scan click
    // before the user toggles the zone open). Calling fit() at w=0/h=0
    // would produce a NaN/zero viewport scale; the ResizeObserver will
    // re-run update once the zone is shown.
    const hasSize = this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
    console.debug("[scan] LinkTreeCanvas.update canvas client size =",
      this.canvas.clientWidth, "x", this.canvas.clientHeight,
      "hasSize=", hasSize, "firstUpdate=", this.firstUpdate);

    if (hasSize && this.firstUpdate) {
      // 首次加载：fit 到全景，若有 active 则居中
      this.fit();
      if (this.activeId && this.layoutMap.has(this.activeId)) {
        this._panToCenter(this.activeId);
      }
      this.firstUpdate = false;
      console.debug("[scan] firstUpdate consumed, fit() called, vp=", this.vp);
    } else if (hasSize && this.activeId && this.layoutMap.has(this.activeId) && activeChanged) {
      // active 切换：平滑动画到新节点（保留 zoom）
      this._animatePanTo(this.activeId);
    }

    // 缓存最新 layout 快照,给导出按钮复用
    this.currentLayoutRoots = layoutRoots;
    this.currentTopicRoot = topicRoot ?? null;

    this._rf();
  }

  /**
   * 序列化为文本。无数据时返回 ""(调用方走"请先生成"分支)。
   * @param format "text" = 缩进树状文本;"mermaid" = graph TD 语法(粘到 .md 直接渲染)。
   *  纯函数,无副作用;实现见 serializeTreeToText / serializeTreeToMermaid。
   */
  getSerializedTree(format: "text" | "mermaid" = "text"): string {
    const fn = format === "mermaid" ? serializeTreeToMermaid : serializeTreeToText;
    return fn({
      layoutRoots: this.currentLayoutRoots,
      topicRoot: this.currentTopicRoot,
    });
  }

  /** 当前缓存的 layoutRoot 数量(0 = 没数据) */
  currentLayoutRootCount(): number {
    return this.currentLayoutRoots.length;
  }

  private _tl(n: TreeNode): LayoutNode {
    // 2026-08 id 化修复:id 用 targetPath(完整路径),保证全 vault 唯一。
    // descendants 永远不是 ghost(isGhost:false)。
    return {
      id: n.event.targetPath,
      children: n.children.map(c => this._tl(c)),
      collapsed: this.collapsed.has(n.event.targetPath),
    };
  }

  // 输入
  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", e => this._pd(e));
    c.addEventListener("pointermove", e => this._pm(e));
    c.addEventListener("pointerup", e => this._pu(e));
    c.addEventListener("pointerleave", () => this._pl());
    c.addEventListener("wheel", e => this._wh(e), { passive: false });
    c.addEventListener("dblclick", () => this.fit());
  }
  private _pos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];
  }
  private _pd(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = true; this.moved = false;
    this.p0 = this._pos(e); this.pL = this.p0;
  }
  private _pm(e: PointerEvent): void {
    const [px, py] = this._pos(e);
    if (this.drag) {
      const dx = px - this.pL[0], dy = py - this.pL[1];
      if (Math.hypot(px - this.p0[0], py - this.p0[1]) > 3) this.moved = true;
      if (this.moved) { this.vp = pan(this.vp, dx, dy); this._rf(); }
      this.pL = [px, py];
    } else {
      const w = screenToWorld(px, py, this.vp);
      const hit = this._ht(w.x, w.y);
      this.hoverId = hit;
      this.canvas.style.cursor = hit ? "pointer" : "grab";
      this._rf();
    }
  }
  private _pu(e: PointerEvent): void {
    if (!this.moved && this.drag) {
      const [px, py] = this._pos(e);
      const w = screenToWorld(px, py, this.vp);
      if (this._hi(w.x, w.y)) {
        this.drag = false;
        return;
      }
      const hit = this._ht(w.x, w.y);
      if (hit && this.evMap.has(hit)) {
        this.clickedId = hit;
        // 320ms 后清除点击光晕，避免残留
        window.setTimeout(() => {
          if (this.clickedId === hit) {
            this.clickedId = null;
            this._rf();
          }
        }, 320);
        this.cb?.onJump(this.evMap.get(hit)!);
        this._rf();
      }
    }
    this.drag = false;
  }
  private _pl(): void { this.drag = false; this.hoverId = null; this._rf(); }
  private _wh(e: WheelEvent): void {
    e.preventDefault();
    const [px, py] = this._pos(e as unknown as PointerEvent);
    this.vp = zoomAt(this.vp, px, py, Math.exp(-e.deltaY * 0.0015));
    this._rf();
  }
  private _ht(wx: number, wy: number): string | null {
    for (const [id, n] of this.layoutMap) {
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return id;
    }
    return null;
  }
  private _hi(wx: number, wy: number): boolean {
    for (const [id, n] of this.layoutMap) {
      if (!n.hasC) continue;
      if (Math.hypot(wx - (n.x + n.w + I_DX), wy - (n.y + n.h / 2)) <= I_R + 3) {
        if (this.collapsed.has(id)) {
          this.collapsed.delete(id);
        } else {
          this.collapsed.add(id);
        }
        this.cb?.onCollapseChange?.(this.collapsed);
        return true;
      }
    }
    return false;
  }
  fit(): void {
    if (!this.layoutMap.size) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.layoutMap.values()) {
      if (n.x < x0) x0 = n.x; if (n.y < y0) y0 = n.y;
      if (n.x + n.w > x1) x1 = n.x + n.w; if (n.y + n.h > y1) y1 = n.y + n.h + I_DX + I_R;
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, p = 60;
    this.vp = defaultViewport();
    this.vp.scale = Math.min(2, Math.min(w / ((x1 - x0) + p), h / ((y1 - y0) + p)));
    this.vp.tx = (w - (x1 + x0) * this.vp.scale) / 2;
    this.vp.ty = (h - (y1 + y0) * this.vp.scale) / 2;
  }
  private _rs = () => this._rf();
  private _ro: ResizeObserver | null = null;
  private _rf(): void {
    if (!this.canvas || !this.renderer) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    console.debug("[scan] _rf render canvas=", w, "x", h, "nodes=", this.nodes.length, "vp.scale=", this.vp.scale);
    this.renderer.render(this.canvas, this.vp, this.nodes, this.edges, this.clickedId, this.activeId, this.hoverId);
  }
  private _panToCenter(id: string): void {
    const n = this.layoutMap.get(id);
    if (!n) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    this.vp.tx = (w / 2) - cx * this.vp.scale;
    this.vp.ty = (h / 2) - cy * this.vp.scale;
  }
  /** 用 RAF 插值动画：~280ms 缓动到目标节点，保留缩放 */
  private _animatePanTo(id: string): void {
    if (this.animRaf !== null) {
      window.cancelAnimationFrame(this.animRaf);
      this.animRaf = null;
    }
    const target = this.layoutMap.get(id);
    if (!target || !this.canvas) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;

    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;

    // 目标 scale：太远拉近、太近拉远到 1.0；正常范围保持
    let targetScale: number;
    if (this.vp.scale < 0.6) targetScale = 1.0;
    else if (this.vp.scale > 1.2) targetScale = 1.0;
    else targetScale = this.vp.scale;
    // 目标 tx/ty 用最终 scale 算，保证居中后节点真的在屏幕中心
    const targetTx = (w / 2) - cx * targetScale;
    const targetTy = (h / 2) - cy * targetScale;

    const startTx = this.vp.tx;
    const startTy = this.vp.ty;
    const startScale = this.vp.scale;
    const duration = 320;
    const t0 = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const k = easeOut(t);
      // 同步插值：缩放按中间值算 tx/ty，再设缩放——保证节点视觉中心稳定
      const curScale = startScale + (targetScale - startScale) * k;
      // 用起始→目标的 tx/ty 插值（按最终 targetScale 算的目标），缩放随动
      this.vp.tx = startTx + (targetTx - startTx) * k;
      this.vp.ty = startTy + (targetTy - startTy) * k;
      this.vp.scale = curScale;
      this._rf();
      if (t < 1) {
        this.animRaf = window.requestAnimationFrame(step);
      } else {
        this.animRaf = null;
      }
    };
    this.animRaf = window.requestAnimationFrame(step);
  }
  setCollapsed(s: Set<string>): void {
    this.collapsed = s;
  }
  destroy(): void {
    if (this.animRaf !== null) {
      window.cancelAnimationFrame(this.animRaf);
      this.animRaf = null;
    }
    if (this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    window.removeEventListener("resize", this._rs);
    try { this._ro?.disconnect(); } catch { /* ResizeObserver 可能已被销毁 */ }
  }
}
