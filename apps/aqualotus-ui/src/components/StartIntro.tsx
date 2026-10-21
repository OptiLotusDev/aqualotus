import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import "./startIntro.css";

interface StartIntroProps {
  /** Called once the timeline has finished; the intro unmounts itself. */
  readonly onFinished: () => void;
}

/** Depth layer of a code fragment — drives size, opacity, and weight. */
type Depth = "far" | "mid" | "near";

interface CodeSlot {
  /** Horizontal offset from the centre, in vw. */
  readonly ox: number;
  /** Vertical offset from the centre, in vh. */
  readonly oy: number;
  readonly depth: Depth;
  /** First text of the slot; the second one replaces it mid-flight. */
  readonly first: string;
  readonly second: string;
  /** Lateral drift while the fragment travels, in vw. */
  readonly drift: number;
  /** Emergence delay, in ms. */
  readonly delay: number;
}

/**
 * The code the intro streams. A small, fixed collection: the effect
 * reads as an active system without becoming a wall of static text.
 */
const CODE_SLOTS: readonly CodeSlot[] = [
  {
    ox: -40,
    oy: -34,
    depth: "far",
    first: "0x01  0x10  0x11",
    second: "0x20  0x40  0x80",
    drift: -1.6,
    delay: 40,
  },
  {
    ox: 27,
    oy: -38,
    depth: "far",
    first: "let entry = graph.entry();",
    second: "let next = cmd.next;",
    drift: 1.2,
    delay: 120,
  },
  {
    ox: -44,
    oy: 4,
    depth: "far",
    first: "ValueId → Node → Output",
    second: "ValueId → Command → Out",
    drift: 1.8,
    delay: 210,
  },
  {
    ox: 35,
    oy: 0,
    depth: "far",
    first: "cmd.next = next_id;",
    second: "cmd.id = 0x1f;",
    drift: -1.1,
    delay: 300,
  },
  {
    ox: -20,
    oy: -40,
    depth: "far",
    first: "0b1010  0b0101",
    second: "0b1100  0b0011",
    drift: 1.4,
    delay: 380,
  },
  {
    ox: -33,
    oy: 23,
    depth: "mid",
    first: "if (ready) execute();",
    second: "if (valid) schedule();",
    drift: 2.2,
    delay: 90,
  },
  {
    ox: 21,
    oy: -27,
    depth: "mid",
    first: "fn execute_graph()",
    second: "fn schedule_graph()",
    drift: -1.9,
    delay: 170,
  },
  {
    ox: -23,
    oy: 34,
    depth: "mid",
    first: "flow.connect(nodeA, nodeB);",
    second: "flow.link(nodeB, nodeC);",
    drift: 1.7,
    delay: 250,
  },
  {
    ox: 37,
    oy: -13,
    depth: "mid",
    first: "const flow = createFlow();",
    second: "const graph = createGraph();",
    drift: -2.1,
    delay: 330,
  },
  {
    ox: 31,
    oy: 35,
    depth: "near",
    first: "const flow = createFlow();",
    second: "const graph = createGraph();",
    drift: 2.6,
    delay: 160,
  },
  {
    ox: -14,
    oy: -31,
    depth: "near",
    first: "ValueId → Output",
    second: "CommandId → Step",
    drift: -2.4,
    delay: 240,
  },
];

/**
 * Intro timeline, in milliseconds. The CSS receives the same numbers
 * as custom properties, so the choreography and the unmount can never
 * drift apart.
 */
const TIMING = {
  /** Fragment travel — ends exactly where the burst starts. */
  fragment: 2200,
  /** White-light burst. */
  burst: 2200,
  burstDuration: 520,
  /** Wordmark reveal. */
  word: 2280,
  wordDuration: 900,
  /** Exit fade; the intro unmounts when it ends. */
  exit: 3180,
  exitDuration: 520,
  /** Total lifetime of the intro. */
  total: 3700,
  /** Reduced-motion lifetime: a brief, low-motion reveal. */
  reducedTotal: 940,
} as const;

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
