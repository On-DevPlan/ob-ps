/**
 * snapshot-hook.test.ts — trackSnapshot 单测
 */

import { describe, it, expect, vi } from "vitest";
import { trackSnapshot } from "./snapshot-hook";
import type { App } from "obsidian";

function makeHost(opts: {
  target: string;
  existing?: { linkTree?: { events: unknown[]; version: number } };
}): { app: App; loadData: () => Promise<unknown> } {
  const files = [{ path: "a.md", stat: { ctime: 1000 } }];
  const cache = { links: [{ link: opts.target }] };
  const unresolved: Record<string, unknown> = { [opts.target]: {} };

  const app = {
    vault: {
      getMarkdownFiles: () => files as never,
      getAbstractFileByPath: () => ({}) as never,
    },
    metadataCache: {
      getFileCache: () => cache as never,
      unresolvedLinks: { "a.md": unresolved } as never,
    },
  } as unknown as App;
  return {
    app,
    loadData: vi.fn().mockResolvedValue(opts.existing ?? { linkTree: { events: [], version: 1 } }),
  };
}

describe("trackSnapshot", () => {
  it("captures unresolved targets", async () => {
    const host = makeHost({ target: "Foo" });
    const out = await trackSnapshot(host, "repair-links");
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Foo");
    expect(out[0].runId).toBe("repair-links");
  });

  it("dedups against existing events", async () => {
    const host = makeHost({
      target: "Foo",
      existing: {
        linkTree: {
          events: [{
            id: "1", target: "Foo", sourcePath: "a.md",
            position: { line: 0, col: 0 }, firstSeenAt: 1, runId: "t",
          }],
          version: 1,
        },
      },
    });
    const out = await trackSnapshot(host, "repair-links");
    expect(out).toHaveLength(0);
  });

  it("returns [] for null data", async () => {
    const host = makeHost({ target: "Foo" });
    host.loadData = vi.fn().mockResolvedValue(null);
    const out = await trackSnapshot(host, "t");
    expect(out).toHaveLength(1);
  });
});
