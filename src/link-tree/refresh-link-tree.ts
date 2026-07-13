import type { CreationEvent } from "./creation-event";
import type { BklinkGraph } from "./topic-resolver";

export interface RefreshLinkTreeDeps {
  events: CreationEvent[];
  activePath: string | null;
  graph: BklinkGraph;
  filter: (
    events: CreationEvent[],
    activePath: string | null,
    graph: BklinkGraph,
  ) => CreationEvent[];
  update: (events: CreationEvent[], activePath: string | null) => void;
  onError: (error: unknown) => void;
}

/**
 * Pull/filter/update orchestration shared by runtime Canvas refresh notifications.
 * The error callback keeps Canvas failures isolated from the persisted scan result.
 */
export function refreshLinkTree(deps: RefreshLinkTreeDeps): void {
  try {
    const filtered = deps.filter(deps.events, deps.activePath, deps.graph);
    deps.update(filtered, deps.activePath);
  } catch (error) {
    deps.onError(error);
  }
}
