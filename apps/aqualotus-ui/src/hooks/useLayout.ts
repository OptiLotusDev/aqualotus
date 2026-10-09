import { useCallback, useState } from "react";
import type { CommandId, FunctionId } from "../lib/optilotus";
import {
  reconcileLayout,
  type LayoutMap,
  type Pos,
} from "../lib/layout";

/**
 * Owns visual layout state (P10/P17): `FunctionId → (CommandId → Pos)`.
 * Coordinates are UI-only and never flow back into Optilotus semantics.
 * Positions survive function switching; reconciliation matches by
 * stable CommandId and auto-places newcomers on every refresh.
 */
export function useLayout(
  fid: FunctionId | null,
  ids: readonly CommandId[],
  startX: number,
  minY: number,
): {
  positions: LayoutMap;
  allPositions: Readonly<Record<number, LayoutMap>>;
  moveBlock: (id: CommandId, pos: Pos) => void;
  moveBlockIn: (target: FunctionId, id: CommandId, pos: Pos) => void;
  placeNextAt: (pos: Pos) => void;
  replaceAll: (target: FunctionId, map: LayoutMap) => void;
} {
  const [store, setStore] = useState<Record<number, LayoutMap>>({});
  // Pending canvas drop point: written by the drop event handler,
  // consumed once by the render-reconciliation below. State (not a
  // ref) so reconciliation during render never reads refs.
  const [pending, setPending] = useState<Pos | null>(null);
  // Reconcile during render (not in an effect): `store[fid]` derives
  // from the authoritative id list, so the map adjusts when `ids`
  // change and plain state otherwise. Newcomers chain right of the
  // rightmost known block (or at the pending drop point).
  const [layoutKey, setLayoutKey] = useState<string>("");
  const current = fid === null ? undefined : store[fid];
  const idsKey = fid === null ? "" : `${fid}:${ids.join(",")}`;
  if (fid !== null && idsKey !== layoutKey) {
    const next = reconcileLayout(
      current ?? {},
      ids,
      pending,
      startX,
      minY,
    );
    const same =
      current !== undefined &&
      Object.keys(next).length === Object.keys(current).length &&
      ids.every((id) => {
        const a = current[id];
        const b = next[id];
        return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
      });
    setLayoutKey(idsKey);
    if (pending !== null) setPending(null);
    if (!same) {
      setStore((prev) => ({ ...prev, [fid]: next }));
    }
  }

  const moveBlock = useCallback(
    (id: CommandId, pos: Pos): void => {
      if (fid === null) return;
      setStore((prev) => ({
        ...prev,
        [fid]: { ...(prev[fid] ?? {}), [id]: pos },
      }));
    },
    [fid],
  );

  const moveBlockIn = useCallback(
    (target: FunctionId, id: CommandId, pos: Pos): void => {
      setStore((prev) => ({
        ...prev,
        [target]: { ...(prev[target] ?? {}), [id]: pos },
      }));
    },
    [],
  );

  const placeNextAt = useCallback((pos: Pos): void => {
    setPending(pos);
  }, []);

  /** Restore a whole position map (view-undo). UI state only. */
  const replaceAll = useCallback((target: FunctionId, map: LayoutMap): void => {
    setStore((prev) => ({ ...prev, [target]: { ...map } }));
  }, []);

  return { positions: fid === null ? {} : (store[fid] ?? {}), allPositions: store, moveBlock, moveBlockIn, placeNextAt, replaceAll };
}
