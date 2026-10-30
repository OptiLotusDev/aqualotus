import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { CODE_SLOTS, TIMING, type CodeSlot } from "./startIntro_constants";
import "./startIntro.css";

interface StartIntroProps {
  /** Called once the timeline has finished; the intro unmounts itself. */
  readonly onFinished: () => void;
}

/** Style bag that also carries custom properties. */
type StyleVars = CSSProperties & Record<`--${string}`, string | number>;

/** Per-slot custom properties consumed by the fragment keyframes. */
function slotStyle(slot: CodeSlot): StyleVars {
  return {
    "--ox": slot.ox,
    "--oy": slot.oy,
    "--drift": slot.drift,
    "--delay": `${slot.delay}ms`,
  };
}

/** Timeline custom properties handed to the stylesheet. */
function timingStyle(): StyleVars {
  return {
    "--intro-fragment-dur": `${TIMING.fragment}ms`,
    "--intro-burst-at": `${TIMING.burst}ms`,
    "--intro-burst-dur": `${TIMING.burstDuration}ms`,
    "--intro-word-at": `${TIMING.word}ms`,
    "--intro-word-dur": `${TIMING.wordDuration}ms`,
    "--intro-exit-at": `${TIMING.exit}ms`,
    "--intro-exit-dur": `${TIMING.exitDuration}ms`,
  };
}

/**
 * Start-page intro: code fragments emerge, converge on the centre, a
 * white-light burst releases, and the AquaLotus wordmark resolves out
 * of it before the overlay fades away.
 *
 * The animation is a pure CSS timeline — no per-frame JavaScript, no
 * React state updates while it runs. The only imperative part is the
 * single timer that unmounts the intro when the timeline ends, so the
 * canvas behind it is revealed exactly on the last frame.
 *
 * The overlay is decorative: it renders above the app, blocks input
 * while it plays, and unmounts completely afterwards.
 */
export default function StartIntro(props: StartIntroProps): ReactElement {
  const { onFinished } = props;
  const reduced = useReducedMotion();
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onFinishedRef.current();
    }, reduced ? TIMING.reducedTotal : TIMING.total);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div
      className={`intro-root${reduced ? " intro-root--reduced" : ""}`}
      style={timingStyle()}
      data-testid="start-intro"
    >
      <div className="intro-glow" aria-hidden="true" />
      {CODE_SLOTS.map((slot, index) => (
        <span
          key={`a-${index}`}
          className={`intro-fragment intro-fragment--${slot.depth}`}
          style={slotStyle(slot)}
          aria-hidden="true"
        >
          {slot.first}
        </span>
      ))}
      {CODE_SLOTS.map((slot, index) => (
        <span
          key={`b-${index}`}
          className={`intro-fragment intro-fragment--alt intro-fragment--${slot.depth}`}
          style={slotStyle(slot)}
          aria-hidden="true"
        >
          {slot.second}
        </span>
      ))}
      <div className="intro-streaks" aria-hidden="true" />
      <div className="intro-burst" aria-hidden="true" />
      <div className="intro-flash" aria-hidden="true" />
      <div className="intro-word">AquaLotus</div>
    </div>
  );
}
