import {
  DEFAULT_FG_VALUES,
  type PluginSettings,
} from "../types/settings";

/** 高亮双链开关对应的 body class 名 */
export const WIKILINK_BODY_CLASS = "ob-ps-hl-wl";

/** 运行时注入的 style 元素 id(覆盖 CM6 未闭合双链颜色 + 用户配置的 fg) */
const INLINE_STYLE_ID = "ob-ps-hl-wl-inline";

/**
 * 根据设置开关添加/移除高亮双链 body class,并 upsert 运行时 inline style。
 * 使用 `activeDocument` 而非 `document` —— popout 窗口下 `document`
 * 指向主窗口,而 Obsidian 推荐访问当前窗口的文档。
 */
export function applyWikilinkStyle(
  settings: PluginSettings,
  doc: Document = activeDocument,
): void {
  if (settings.highlightWikilinks) {
    doc.body.addClass(WIKILINK_BODY_CLASS);
  } else {
    doc.body.removeClass(WIKILINK_BODY_CLASS);
  }
  upsertInlineStyle(settings, doc);
}

/** 解析字段:undefined 时返回 fallback */
function resolveFg(
  value: string | undefined,
  fallback: string,
): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * 始终 upsert 同一个 `<style id="ob-ps-hl-wl-inline">`:
 *   - highlightWikilinks=false 时整个 remove
 *   - =true 时创建(若不存在)并按 settings 生成 fg + CM6 兜底规则
 * 样式表顺序:晚于 styles.css,所以其规则胜出。
 */
export function upsertInlineStyle(
  settings: PluginSettings,
  doc: Document,
): void {
  const existing = doc.getElementById(INLINE_STYLE_ID);
  if (!settings.highlightWikilinks) {
    if (existing) existing.remove();
    return;
  }
  const el = existing ?? doc.createElement("style");
  if (!existing) {
    el.id = INLINE_STYLE_ID;
    doc.head.appendChild(el);
  }
  el.textContent = renderInlineStyle(settings);
}

/**
 * 渲染 inline style 文本:
 *   - CM6 未闭合 [[ 兜底规则(原 injectInlineStyles 内容)
 *   - 用户 fg 写入 body.ob-ps-hl-wl(亮)+ body.ob-ps-hl-wl.theme-dark(暗)
 *   - 任一字段 undefined 时使用 DEFAULT_FG_VALUES 对应 fallback
 */
export function renderInlineStyle(settings: PluginSettings): string {
  const light = {
    resolved:   resolveFg(settings.highlightWikilinksResolvedFg,   DEFAULT_FG_VALUES.light.resolved),
    unresolved: resolveFg(settings.highlightWikilinksUnresolvedFg, DEFAULT_FG_VALUES.light.unresolved),
  };
  const dark = {
    resolved:   resolveFg(settings.highlightWikilinksResolvedFgDark,   DEFAULT_FG_VALUES.dark.resolved),
    unresolved: resolveFg(settings.highlightWikilinksUnresolvedFgDark, DEFAULT_FG_VALUES.dark.unresolved),
  };
  return [
    /* CM6 未闭合双链上下文内的 barelink —— 沿用未解析色(亮) */
    `body.ob-ps-hl-wl .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
    /* 阅读视图的外链兼容(防外部链接泄露) */
    `body.ob-ps-hl-wl .cm-s-obsidian .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
    /* 亮主题 fg 由用户配置覆盖 fallback */
    `body.ob-ps-hl-wl {`,
    `  --ob-wl-resolved-fg: ${light.resolved};`,
    `  --ob-wl-resolved-fg-rgb: ${hexToRgbTriplet(light.resolved)};`,
    `  --ob-wl-unresolved-fg: ${light.unresolved};`,
    `  --ob-wl-unresolved-fg-rgb: ${hexToRgbTriplet(light.unresolved)};`,
    `}`,
    /* 暗主题 fg 由用户配置覆盖 fallback */
    `body.ob-ps-hl-wl.theme-dark {`,
    `  --ob-wl-resolved-fg: ${dark.resolved};`,
    `  --ob-wl-resolved-fg-rgb: ${hexToRgbTriplet(dark.resolved)};`,
    `  --ob-wl-unresolved-fg: ${dark.unresolved};`,
    `  --ob-wl-unresolved-fg-rgb: ${hexToRgbTriplet(dark.unresolved)};`,
    `}`,
    /* 暗主题 CM6 未闭合双链 —— 沿用未解析色 */
    `body.ob-ps-hl-wl.theme-dark .cm-hmd-barelink.cm-link {`,
    `  color: var(--ob-wl-unresolved-fg) !important;`,
    `}`,
  ].join("\n");
}

/** 把 #RRGGBB 转成 CSS rgba() 函数可用形参 "R G B"。非法输入兜底黑色。 */
export function hexToRgbTriplet(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "0 0 0";
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}