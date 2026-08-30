import { describe, it, expect, vi, afterEach } from "vitest";
import { formatCtime } from "./inspector-render";

// 复刻 Obsidian 全局 moment 的最小替身:记录入参,format 返回固定串
// 测试环境无 jsdom,故 window 也不存在——挂到 globalThis 上再指向 window。
function installMomentStub() {
  const formatSpy = vi.fn((fmt: string) => `formatted:${fmt}`);
  const momentStub = vi.fn((input: unknown) => ({
    input,
    format: formatSpy,
    isSame: () => false,
  }));
  (globalThis as Record<string, unknown>).window = { moment: momentStub };
  return formatSpy;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("formatCtime", () => {
  it("正常时间戳传给 moment", () => {
    const formatSpy = installMomentStub();
    formatCtime(1781687605000);
    expect(formatSpy).toHaveBeenCalled();
  });
});
