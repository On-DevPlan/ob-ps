import { describe, expect, it, vi } from "vitest";
import type { CreationEvent } from "./creation-event";
import type { BklinkGraph } from "./topic-resolver";
import { refreshLinkTree } from "./refresh-link-tree";

const EVENTS = [{ target: "a" }] as CreationEvent[];
const FILTERED = [{ target: "current" }] as CreationEvent[];
const GRAPH: BklinkGraph = { forward: new Map(), backward: new Map() };

describe("refreshLinkTree", () => {
  it("filters and updates once using the current active note", () => {
    const filter = vi.fn(() => FILTERED);
    const update = vi.fn();

    refreshLinkTree({
      events: EVENTS,
      activePath: "current.md",
      graph: GRAPH,
      filter,
      update,
      onError: vi.fn(),
    });

    expect(filter).toHaveBeenCalledOnce();
    expect(filter).toHaveBeenCalledWith(EVENTS, "current.md", GRAPH);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(FILTERED, "current.md");
  });

  it("forwards null active path", () => {
    const filter = vi.fn(() => EVENTS);
    const update = vi.fn();

    refreshLinkTree({
      events: EVENTS,
      activePath: null,
      graph: GRAPH,
      filter,
      update,
      onError: vi.fn(),
    });

    expect(filter).toHaveBeenCalledWith(EVENTS, null, GRAPH);
    expect(update).toHaveBeenCalledWith(EVENTS, null);
  });

  it("contains update failures and reports them", () => {
    const failure = new Error("canvas failed");
    const onError = vi.fn();

    expect(() => refreshLinkTree({
      events: EVENTS,
      activePath: "current.md",
      graph: GRAPH,
      filter: () => FILTERED,
      update: () => { throw failure; },
      onError,
    })).not.toThrow();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
