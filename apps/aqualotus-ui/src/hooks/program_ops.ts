import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type {
  CommandId,
  FunctionId,
} from "../lib/optilotus";
import type { HistoryEntry } from "../lib/history";
import type { HistoryIdMap } from "../lib/history";
import type { ProgramSnapshot } from "./program_state";
import type { LinkPlan } from "../lib/graph";
import type { CommandDraft } from "../lib/program";

/** Shared dependency context for program feature modules.
 *
 * `useProgram` owns the single authoritative snapshot and all refs.
 * Feature modules receive this typed context and perform operations
 * against it — they never own state themselves.
 */
export interface ProgramMutationContext {
  readonly snapshot: ProgramSnapshot;
  readonly setSnapshot: Dispatch<SetStateAction<ProgramSnapshot>>;
  readonly remapRef: MutableRefObject<HistoryIdMap>;
  readonly plannedRef: MutableRefObject<Map<number, Map<number, number>>>;
  readonly selectedIdRef: MutableRefObject<FunctionId | null>;
  readonly pastRef: MutableRefObject<HistoryEntry[]>;
  readonly futureRef: MutableRefObject<HistoryEntry[]>;
  readonly syncTops: () => void;
  readonly pushHistory: (entry: Omit<HistoryEntry, "seq">) => void;
  readonly load: (selectedId: FunctionId | null) => void;
  /** Low-level command operations (imported by feature modules directly). */
  readonly createDetached: (
    fid: FunctionId,
    draft: CommandDraft,
  ) => number | null;
  readonly runLinkPlan: (fid: FunctionId, plan: LinkPlan) => boolean;
  readonly restoreLinks: (
    fid: FunctionId,
    links: ReadonlyMap<number, number | null>,
    entry: number | null,
    keepEntry: boolean,
  ) => boolean;
  readonly insertSlot: (
    fid: FunctionId,
    draft: CommandDraft,
    slot: { prevId: number | null; nextId: number | null; makeEntry: boolean },
    restoresId?: number,
  ) => number | null;
  readonly deleteVisibleCommand: (fid: FunctionId, id: CommandId) => boolean;
  readonly appendIntoBranch: (
    fid: FunctionId,
    ifId: CommandId,
    branch: "then" | "else",
    targetId: CommandId,
    record?: boolean,
  ) => boolean;
}
