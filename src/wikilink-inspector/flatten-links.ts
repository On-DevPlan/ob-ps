import type { Editor } from "obsidian";

/**
 * 将编辑器里的所有 [[双链]] 转为 [单链]：
 *   - [[target]]          → [target]
 *   - [[target|display]]  → [display]
 *
 * 从后往前替换以免位置漂移。每次替换构成独立的撤销步。
 * 返回替换的数量。
 */
export function flattenWikilinks(editor: Editor): number {
  const text = editor.getValue();
  const regex = /\[\[([^\]|]+)(?:\|([^\]|]+))?\]\]/g;
  let match: RegExpExecArray | null;
  const ops: { offset: number; len: number; text: string }[] = [];

  while ((match = regex.exec(text)) !== null) {
    ops.push({
      offset: match.index,
      len: match[0].length,
      text: `[${match[2] || match[1]}]`,
    });
  }

  if (ops.length === 0) return 0;

  for (let i = ops.length - 1; i >= 0; i--) {
    const { offset, len, text: replacement } = ops[i];
    const from = offsetToPos(text, offset);
    const to = offsetToPos(text, offset + len);
    editor.replaceRange(replacement, from, to);
  }

  return ops.length;
}

/** 全文字符偏移 → { line, ch }（line 从 0 开始） */
function offsetToPos(text: string, offset: number): { line: number; ch: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}
