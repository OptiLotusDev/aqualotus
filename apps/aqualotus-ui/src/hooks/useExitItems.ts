import { useEffect, useRef, useState } from "react";

/**
 * Exit-animation window in milliseconds. It matches the CSS
 * `--transition-fast` token the exit animations use, so an element
 * leaves the DOM exactly when its fade is over.
 */
export const EXIT_MS = 150;

/** An item that just left the list and is playing its exit animation. */
export interface ExitingItem<T> {
  /** Stable key of the item (its identity in the list). */
  readonly key: string;
  /** The item as it was when it left. */
  readonly item: T;
}

/** Items that left in the same frame — one batch, one exit timer. */
interface ExitBatch<T> {
  readonly id: number;
  readonly items: readonly ExitingItem<T>[];
}

/**
 * Keeps items that just left a list alive for one exit animation.
 *
 * Presentation only: the application state changes immediately (the item
 * is gone from the model), and only its picture lingers for
 * `durationMs` so it can fade out instead of blinking away. The hook
 * never touches the model, never keeps the same item twice, and never
 * leaves a ghost behind: the removal is detected during render — so the
 * ghost appears in the very frame its item left — and every pending exit
 * is cleaned up on unmount.
 */
export function useExitItems<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  durationMs: number = EXIT_MS,
): readonly ExitingItem<T>[] {
  const [previous, setPrevious] = useState<readonly T[]>(items);
  const [batches, setBatches] = useState<readonly ExitBatch<T>[]>([]);
  const liveKeys = new Set(items.map((item) => keyOf(item)));

  // Derived state: the list changed, so the items that left it become
  // ghosts. Adjusting the state during render (instead of in an effect)
  // keeps the ghost in the same frame as the removal — no blink.
  if (previous !== items) {
    const removed = previous.filter((item) => !liveKeys.has(keyOf(item)));
    setPrevious(items);
    if (removed.length > 0) {
      const added: readonly ExitingItem<T>[] = removed.map((item) => ({
        key: keyOf(item),
        item,
      }));
      setBatches((prev) => {
        // An item that leaves twice has one ghost, not two: the new one
        // replaces the old.
        const addedKeys = new Set(added.map((a) => a.key));
        const kept: ExitBatch<T>[] = [];
        for (const batch of prev) {
          const items = batch.items.filter((e) => !addedKeys.has(e.key));
          if (items.length > 0) kept.push({ ...batch, items });
        }
        const id = prev.reduce((max, batch) => Math.max(max, batch.id), 0) + 1;
        return [...kept, { id, items: added }];
      });
    }
  }

  // Every ghost leaves the DOM when its fade is over. The timers live in
  // a ref so an unrelated re-render cannot cancel a pending exit (that
  // would strand the element); they are all cleared on unmount.
  const scheduledRef = useRef<ReadonlySet<number>>(new Set<number>());
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    const fresh = batches.filter((batch) => !scheduledRef.current.has(batch.id));
    if (fresh.length === 0) return;
    for (const batch of fresh) {
      scheduledRef.current = new Set([...scheduledRef.current, batch.id]);
      const timer = window.setTimeout(() => {
        scheduledRef.current = new Set(
          [...scheduledRef.current].filter((id) => id !== batch.id),
        );
        setBatches((prev) => prev.filter((b) => b.id !== batch.id));
      }, durationMs);
      timersRef.current = [...timersRef.current, timer];
    }
  }, [batches, durationMs]);
  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    },
    [],
  );

  // An item that came back (an undo, a re-created row) has no ghost.
  return batches
    .flatMap((batch) => batch.items)
    .filter((e) => !liveKeys.has(e.key));
}
