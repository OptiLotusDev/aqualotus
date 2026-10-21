import { useEffect, useRef, type ReactElement } from "react";
import {
  FLUID_BLOB_COUNT,
  FLUID_BURST_SECONDS,
  FLUID_COLOR_TOKENS,
  FLUID_FALLBACK_COLORS,
  IDLE_POINTER,
  burstEnvelope,
  createFluidBlobs,
  stepFluidBlobs,
  type FluidBlob,
  type FluidPointer,
} from "../lib/fluid";
import { useReducedMotion } from "../hooks/useReducedMotion";

/**
 * Internal resolution factor. The ink is soft by design, so it is
 * rendered below device resolution and scaled up by the compositor —
 * far cheaper than a full-resolution blur, and the softness reads as
 * depth rather than as blur.
 */
const QUALITY_DESKTOP = 0.55;
const QUALITY_COMPACT = 0.4;

/** Device pixel ratio ceiling (HiDPI displays cost fill rate). */
const MAX_DPR = 2;

/** Minimum frame interval on compact viewports (≈30 fps). */
const COMPACT_FRAME_MS = 33;

/** Trail fade per frame: the ink keeps a short memory of its path. */
const FADE_ALPHA = 0.06;

/** Steady-state ink alpha, and the alpha of the opening burst. */
const BASE_ALPHA = 0.48;
const VIVID_ALPHA = 0.8;

/** Strength of the central darkening that keeps text readable. */
const VIGNETTE_ALPHA = 0.42;

const COMPACT_QUERY = "(max-width: 767px)";

/** Read a colour token from the document root. */
function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value === "" ? fallback : value;
}

/** Read the ink palette from the token layer. */
function readPalette(): readonly string[] {
  return FLUID_COLOR_TOKENS.map((token, i) =>
    readToken(token, FLUID_FALLBACK_COLORS[i]),
  );
}

/**
 * Decorative atmospheric layer: colorful ink drifting through dark
 * water behind the whole application.
 *
 * Isolation (P14): the canvas is `pointer-events: none`, never
 * captures input, and owns no application state — it only reads the
 * CSS token layer and the pointer position. It paints behind the
 * shell, so block selection, dragging, wiring, and execution are
 * untouched. Rendering is isolated from React: the loop keeps its
 * state in local variables and never triggers a re-render.
 */
export default function FluidBackdrop(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = canvasRef.current;
    if (element === null) return;
    const context = element.getContext("2d");
    // No 2d context (older WebViews, locked-down browsers): the CSS
    // background stack stays as the fallback atmosphere.
    if (context === null) return;
    // Non-nullable aliases: the paint helpers below are closures, and
    // the narrowed types must survive into them.
    const canvas = element;
    const ctx = context;

    const compact =
      typeof window.matchMedia === "function" &&
      window.matchMedia(COMPACT_QUERY).matches;

    let palette = readPalette();
    let background = readToken("--fluid-bg", "#04050c");
    let theme = document.documentElement.dataset.theme ?? "night";
    let blobs: readonly FluidBlob[] = createFluidBlobs(FLUID_BLOB_COUNT);
    let pointer: FluidPointer = IDLE_POINTER;
    let width = 0;
    let height = 0;
    let elapsed = 0;
    let lastPaint = 0;
    let lastFrame = 0;
    let frameHandle = 0;

    function resize(): void {
      const cssW = Math.max(1, window.innerWidth);
      const cssH = Math.max(1, window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = dpr * (compact ? QUALITY_COMPACT : QUALITY_DESKTOP);
      width = cssW;
      height = cssH;
      canvas.width = Math.max(1, Math.round(cssW * scale));
      canvas.height = Math.max(1, Math.round(cssH * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    function draw(): void {
      // Fade the previous frame: the ink keeps a short trail.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = FADE_ALPHA;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      // Additive blending makes overlapping trails glow like ink in
      // water rather than stacking into flat paint.
      ctx.globalCompositeOperation = "lighter";
      const burst = burstEnvelope(elapsed);
      ctx.globalAlpha = BASE_ALPHA + burst * (VIVID_ALPHA - BASE_ALPHA);
      for (const blob of blobs) {
        const color = palette[blob.colorIndex % palette.length];
        const radius = blob.radius * height * (1 + burst * 0.45);
        ctx.save();
        ctx.translate(blob.x * width, blob.y * height);
        ctx.rotate(blob.angle);
        // A long, linear falloff keeps the ink soft: a short plateau
        // would draw a visible rim around every blob.
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(0.15, color);
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius / blob.stretch, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Central darkening: the middle of the screen carries the
      // editor and its text, so the ink is pulled back from it.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = VIGNETTE_ALPHA;
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      vignette.addColorStop(0, background);
      vignette.addColorStop(0.55, background);
      vignette.addColorStop(1, "transparent");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    function onFrame(now: number): void {
      if (theme === "light") {
        // Light mode hides the layer: stop the loop entirely until the
        // theme flips back (see `onThemeChange`).
        frameHandle = 0;
        return;
      }
      frameHandle = requestAnimationFrame(onFrame);
      if (document.hidden) return;
      if (compact && now - lastFrame < COMPACT_FRAME_MS) return;
      lastFrame = now;
      const dt = lastPaint === 0 ? 0 : Math.min((now - lastPaint) / 1000, 0.05);
      lastPaint = now;
      elapsed += dt;
      blobs = stepFluidBlobs(blobs, elapsed, dt, pointer);
      draw();
    }

    function onPointerMove(event: PointerEvent): void {
      pointer = {
        x: event.clientX / Math.max(1, window.innerWidth),
        y: event.clientY / Math.max(1, window.innerHeight),
        active: true,
      };
    }

    function onPointerExit(): void {
      pointer = IDLE_POINTER;
    }

    function onThemeChange(): void {
      theme = document.documentElement.dataset.theme ?? "night";
      palette = readPalette();
      background = readToken("--fluid-bg", "#04050c");
      if (theme !== "light" && frameHandle === 0 && !reduced) {
        frameHandle = requestAnimationFrame(onFrame);
      }
    }

    const observer = new MutationObserver(onThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointercancel", onPointerExit);
    window.addEventListener("blur", onPointerExit);
    document.addEventListener("pointerleave", onPointerExit);

    resize();

    if (reduced) {
      // Reduced motion: one calm, static frame — no animation loop.
      elapsed = FLUID_BURST_SECONDS;
      draw();
    } else {
      frameHandle = requestAnimationFrame(onFrame);
    }

    return () => {
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointercancel", onPointerExit);
      window.removeEventListener("blur", onPointerExit);
      document.removeEventListener("pointerleave", onPointerExit);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      className="fluid-backdrop"
      aria-hidden="true"
      data-testid="fluid-backdrop"
    />
  );
}
