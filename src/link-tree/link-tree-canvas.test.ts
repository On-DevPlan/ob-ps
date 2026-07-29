/**
 * link-tree-canvas.test.ts — 测试 serializeTreeToText 纯函数
 *
 * 不依赖 jsdom:仅测纯序列化逻辑。按钮点击 + 剪贴板写入属 E2E 范畴,
 * 本项目无 E2E 框架,不覆盖。
 */

import { describe, expect, it } from "vitest";
import { serializeTreeToText, serializeTreeToMermaid, type SerializeInput } from "./link-tree-canvas";
import type { LayoutNode } from "./tree-layout";

/** 简写构造器 —— 让测试用例可读性更好 */
function ln(id: string, children: LayoutNode[] = [], collapsed = false): LayoutNode {
  return { id, children, collapsed };
}

describe("serializeTreeToText", () => {
  it("空 layoutRoots 返回 header + (空) 提示", () => {
    const out = serializeTreeToText({ layoutRoots: [], topicRoot: "前端" });
    expect(out).toBe("主题: 前端\n\n(空)");
  });

  it("topicRoot 为 null 时 header 显示 untitled", () => {
    const out = serializeTreeToText({ layoutRoots: [], topicRoot: null });
    expect(out).toContain("主题: untitled");
  });

  it("单个 bare layoutRoot 输出 - 前缀", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [ln("工程化")],
    };
    const out = serializeTreeToText(input);
    expect(out).toBe("主题: 前端\n\n- 工程化\n");
  });

  it("ghost 节点用 📁 前缀 + id 末段", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [
        ln("前端/前端.md", [
          ln("工程化", [ln("性能优化"), ln("options填写的是hook时机吗")]),
          ln("ts", [ln("闭包是编译期还是运行期被确定")]),
        ]),
      ],
    };
    const out = serializeTreeToText(input);
    expect(out).toContain("📁 前端.md");
    expect(out).toContain("  - 工程化");
    expect(out).toContain("    - 性能优化");
    expect(out).toContain("    - options填写的是hook时机吗");
    expect(out).toContain("  - ts");
    expect(out).toContain("    - 闭包是编译期还是运行期被确定");
  });

  it("ghost + bare 并列(layoutRoot 之间换行)", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [
        ln("前端/前端.md", [ln("工程化")]),
        ln("工程化", [ln("性能优化")]),
      ],
    };
    const out = serializeTreeToText(input);
    const lines = out.split("\n");
    // ghost "📁 前端.md" 的孩子 "工程化" 在它内部出现,
    // bare "工程化"(root2)单独成行。验证 bare root 之前有空行
    const bareRootIdx = lines.findIndex((l) => l === "- 工程化");
    expect(bareRootIdx).toBeGreaterThan(0);
    expect(lines[bareRootIdx - 1]).toBe("");
    // bare 自身的子节点 "性能优化" 前缀是 "  -"(depth 1,缩进 2 空格)
    expect(out).toContain("  - 性能优化");
  });

  it("多层嵌套保持 2 空格缩进", () => {
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [ln("A", [ln("B", [ln("C", [ln("D")])])])],
    };
    const out = serializeTreeToText(input);
    const lines = out.split("\n");
    // A 在 depth=0,无缩进;- B depth=1,2 空格;- C depth=2,4 空格;- D depth=3,6 空格
    expect(lines.find((l) => l === "- A")).toBeDefined();
    expect(lines.find((l) => l === "  - B")).toBeDefined();
    expect(lines.find((l) => l === "    - C")).toBeDefined();
    expect(lines.find((l) => l === "      - D")).toBeDefined();
  });

  it("collapsed 节点输出 (N) 标记,不再展开子节点", () => {
    // A 的孩子 B 被折叠,B 自身有 1 个孩子 C
    // countDescendants(B) = children.length(1) + countDescendants(C)(0) = 1
    // 但 B 是个裸节点,深度 1,所以实际输出 "  - B (1)"
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [
        ln("A", [
          ln("B", [ln("C", [ln("D")])], /*collapsed=*/ true),
          ln("B2"),
        ]),
      ],
    };
    const out = serializeTreeToText(input);
    // B 折叠,数 = children.length(1:C) + 递归 C 的后裔数(D=1) = 1 + 1 = 2
    expect(out).toContain("  - B (2)");
    expect(out).not.toContain("- C");
    expect(out).not.toContain("- D");
    // B2 不折叠,正常展开
    expect(out).toContain("  - B2");
  });

  it("collapsed 计数正确:C 有 1 个孩子 D → B 的后裔 = 1 (C) + 1 (C→D) = 2", () => {
    // 与上一条独立,确认递归累加语义
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [ln("A", [ln("B", [ln("C", [ln("D")])], true)])],
    };
    const out = serializeTreeToText(input);
    expect(out).toContain("  - B (2)");
  });

  it("中文 target 原样保留(不转义、不截断)", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [ln("为什么体现oop思想"), ln("闭包是编译期还是运行期被确定")],
    };
    const out = serializeTreeToText(input);
    expect(out).toContain("- 为什么体现oop思想");
    expect(out).toContain("- 闭包是编译期还是运行期被确定");
  });

  it("ghost 节点 id 不含 / 时降级为普通 - 前缀", () => {
    // 边界情况:id 不含 slash 时,本应被识别为 ghost 的分支不会被触发
    // 这里用没有 children 的单节点 —— 会按 bare 处理
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [ln("only-root")],
    };
    const out = serializeTreeToText(input);
    expect(out).toContain("- only-root");
    expect(out).not.toContain("📁");
  });
});

describe("serializeTreeToMermaid", () => {
  it("空 layoutRoots 输出围栏 + graph TD 头", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [], topicRoot: "前端" });
    expect(out).toBe("```mermaid\n%% topic: 前端\ngraph TD\n```\n");
  });

  it("单节点:n0 定义,无连线", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln("A")], topicRoot: "T" });
    expect(out).toBe('```mermaid\n%% topic: T\ngraph TD\n  n0["A"]\n```\n');
  });

  it("单链 A→B 输出 2 个定义 + 1 条边,夹在围栏里", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln("A", [ln("B")])], topicRoot: "T" });
    const lines = out.split("\n");
    expect(lines[0]).toBe("```mermaid");
    expect(lines[1]).toBe("%% topic: T");
    expect(lines[2]).toBe("graph TD");
    expect(lines[3]).toBe('  n0["A"]');
    expect(lines[4]).toBe("  n0 --> n1");
    expect(lines[5]).toBe('  n1["B"]');
    expect(lines[6]).toBe("```");
  });

  it("topicRoot=null 时注释显示 untitled", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln("A")], topicRoot: null });
    expect(out).toContain("%% topic: untitled");
  });

  it("首尾是围栏 ```mermaid 与 ```,不在中间出现", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln("A", [ln("B")])], topicRoot: "T" });
    const fenceCount = (out.match(/^```mermaid$/gm) || []).length;
    const closeFenceCount = (out.match(/^```$/gm) || []).length;
    expect(fenceCount).toBe(1);
    expect(closeFenceCount).toBe(1);
  });

  it("ghost layoutRoot 用 📁 前缀 + 末段 label", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [ln("前端/前端.md", [ln("工程化", [ln("性能优化")])])],
    };
    const out = serializeTreeToMermaid(input);
    expect(out).toContain('  n0["📁 前端.md"]');
    expect(out).toContain('  n1["工程化"]');
    expect(out).toContain('  n2["性能优化"]');
    // ghost 后正常 n0 → n1 → n2 连边
    expect(out).toContain("  n0 --> n1");
    expect(out).toContain("  n1 --> n2");
  });

  it("label 含双引号或反斜杠会转义", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln(`He said "hi" \\path`)], topicRoot: "T" });
    // 反斜杠转义为 \\,双引号转义为 \"
    expect(out).toContain(`n0["He said \\"hi\\" \\\\path"]`);
  });

  it("mermaid id 全局自增,跨 layoutRoot 仍唯一", () => {
    // 两个 root + 子节点 → id 不能重复
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [
        ln("root1", [ln("A")]),
        ln("root2", [ln("B")]),
      ],
    };
    const out = serializeTreeToMermaid(input);
    // 从定义行 `  n0["root1"]` 中提取 id —— 用 `n数字` 后面紧跟 `[` 防止误抓边中的 n0
    const defIds = [...out.matchAll(/n(\d+)\["/g)].map((m) => m[1]);
    const unique = new Set(defIds);
    expect(unique.size).toBe(4); // root1, A, root2, B
    // id 必须从 0 到 3 连续
    expect([...unique].sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("同名节点不会冲突:id 唯一,label 重复", () => {
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [ln("X"), ln("X")], // 两个根都叫 X
    };
    const out = serializeTreeToMermaid(input);
    const ids = [...out.matchAll(/n\d+/g)].map((m) => m[0]);
    const unique = new Set(ids);
    expect(unique.size).toBe(2);
    // 两条 X label 都出现
    const labels = [...out.matchAll(/\["X"\]/g)];
    expect(labels.length).toBe(2);
  });

  it("折叠节点不展开子节点,无对应边", () => {
    const input: SerializeInput = {
      topicRoot: "T",
      layoutRoots: [ln("A", [ln("B", [ln("C"), ln("D")], true)])],
    };
    const out = serializeTreeToMermaid(input);
    expect(out).toContain('  n0["A"]');
    expect(out).toContain('  n1["B"]');
    expect(out).not.toContain('n2["C"]');
    expect(out).not.toContain('n2["D"]');
    // 只有 A → B 一条边
    expect(out).toContain("  n0 --> n1");
    expect((out.match(/-->/g) || []).length).toBe(1);
  });

  it("中文 label 原样保留", () => {
    const input: SerializeInput = {
      topicRoot: "前端",
      layoutRoots: [ln("为什么体现oop思想")],
    };
    const out = serializeTreeToMermaid(input);
    expect(out).toContain('n0["为什么体现oop思想"]');
  });

  it("graph TD 是 graph TD 行,所有定义/边以 2 空格缩进,围栏裸 ```", () => {
    const out = serializeTreeToMermaid({ layoutRoots: [ln("A", [ln("B")])], topicRoot: "T" });
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe("```mermaid");
    expect(lines[1]).toBe("%% topic: T");
    expect(lines[2]).toBe("graph TD");
    // 中间定义/边行以 2 空格缩进(过滤掉围栏与头部)
    for (const l of lines.slice(3, -1)) {
      expect(l.startsWith("  ")).toBe(true);
    }
    expect(lines[lines.length - 1]).toBe("```");
  });
});
