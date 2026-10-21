/**
 * Fluid backdrop simulation — presentation only (never semantics).
 *
 * Honest functions (P3): every result is derived from the explicit
 * inputs. The initial layout comes from a seeded generator, so the
 * effect is reproducible and unit-testable without a canvas. Nothing
 * here touches the program model, the bridge, or the editor state.
 */

/** Palette token names, read from the CSS token layer at paint time. */
export const FLUID_COLOR_TOKENS = [
  "--fluid-cyan",
  "--fluid-blue",
  "--fluid-violet",
  "--fluid-magenta",
] as const;

/** Fallback palette used when the token layer cannot be read. */
export const FLUID_FALLBACK_COLORS = [
  "#22d3ee",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
] as const;

/** Ink blobs drawn per frame. */
export const FLUID_BLOB_COUNT = 9;

/** Length of the vivid opening burst, in seconds. */
export const FLUID_BURST_SECONDS = 1.4;

/** Drift speed in normalized screen units per second (slow, continuous). */
const DRIFT = 0.02;

/** Pointer influence radius, in normalized screen units. */
const POINTER_REACH = 0.5;

/** Pointer attraction strength, in normalized screen units per second. */
const POINTER_PULL = 0.05;

/** One ink blob: position, motion, and its place in the palette. */
export interface FluidBlob {
  /** Normalized screen position (0..1 on both axes). */
  readonly x: number;
  readonly y: number;
  /** Current velocity, normalized units per second. */
  readonly vx: number;
  readonly vy: number;
  /** Blob radius as a fraction of the viewport height. */
  readonly radius: number;
  /** Elongation factor (1 = round, > 1 = stretched). */
  readonly stretch: number;
  /** Current rotation, radians. */
  readonly angle: number;
  /** Rotation speed, radians per second. */
  readonly spin: number;
  /** Index into the palette. */
  readonly colorIndex: number;
  /** Phase offset of the flow field for this blob. */
  readonly phase: number;
}

/** Pointer position in normalized screen space. */
export interface FluidPointer {
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
}

/** Pointer state used when no pointer has been seen. */
export const IDLE_POINTER: FluidPointer = { x: 0.5, y: 0.5, active: false };

/** Deterministic pseudo-random generator (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from the centre that stays clear of ink (normalized). */
const CLEAR_CENTER = 0.3;

/**
 * Initial blob layout. Blobs start near the periphery: the centre of
 * the screen carries text, so the ink stays out of the reading area.
 */
export function createFluidBlobs(
  count: number,
  seed = 1,
): readonly FluidBlob[] {
  const rand = mulberry32(seed);
  const blobs: FluidBlob[] = [];
  for (let i = 0; i < count; i += 1) {
    let x = 0.05 + rand() * 0.9;
    let y = 0.05 + rand() * 0.9;
    // Push the blob out of the reading area, keeping its direction.
    const dx = x - 0.5;
    const dy = y - 0.5;
    const distance = Math.hypot(dx, dy);
    if (distance < CLEAR_CENTER) {
      const scale = distance < 1e-4 ? 0 : CLEAR_CENTER / distance;
      x = 0.5 + dx * scale;
      y = 0.5 + dy * scale;
    }
    blobs.push({
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 0.12 + rand() * 0.1,
      stretch: 1.05 + rand() * 0.5,
      angle: rand() * Math.PI,
      spin: (rand() - 0.5) * 0.25,
      colorIndex: i % FLUID_FALLBACK_COLORS.length,
      phase: rand() * Math.PI * 2,
    });
  }
  return blobs;
}

/** Mirror a coordinate back into the visible range. */
function reflect(v: number): number {
  if (v < 0) return -v;
  if (v > 1) return 2 - v;
  return v;
}

/**
 * Advance the simulation. The flow field is a slow sum of sines, so
 * the motion is continuous and organic rather than random. A pointer
 * inside the reach adds a gentle pull and swirl.
 */
export function stepFluidBlobs(
  blobs: readonly FluidBlob[],
  time: number,
  dt: number,
  pointer: FluidPointer,
): readonly FluidBlob[] {
  return blobs.map((blob) => {
    const ax =
      Math.sin(blob.y * 3.3 + time * 0.21 + blob.phase) * 0.6 +
      Math.cos(blob.x * 2.7 - time * 0.16) * 0.4;
    const ay =
      Math.cos(blob.x * 2.9 - time * 0.18 + blob.phase * 0.7) * 0.6 -
      Math.sin(blob.y * 3.6 + time * 0.12) * 0.5;
    let vx = ax * DRIFT;
    let vy = ay * DRIFT;

    if (pointer.active) {
      const dx = pointer.x - blob.x;
      const dy = pointer.y - blob.y;
      const dist = Math.hypot(dx, dy);
      if (dist < POINTER_REACH && dist > 1e-4) {
        const falloff = (1 - dist / POINTER_REACH) ** 2;
        const pull = falloff * POINTER_PULL;
        const ux = dx / dist;
        const uy = dy / dist;
        vx += ux * pull - uy * pull * 0.6;
        vy += uy * pull + ux * pull * 0.6;
      }
    }

    return {
      ...blob,
      x: reflect(blob.x + vx * dt),
      y: reflect(blob.y + vy * dt),
      vx,
      vy,
      angle: blob.angle + blob.spin * dt,
    };
  });
}

/**
 * Opening burst envelope: 1 at the very start, easing down to 0 over
 * `FLUID_BURST_SECONDS`. Drives the vivid reveal and the settle into
 * the subtle continuous drift.
 */
export function burstEnvelope(elapsed: number): number {
  const t = Math.min(Math.max(elapsed / FLUID_BURST_SECONDS, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}
