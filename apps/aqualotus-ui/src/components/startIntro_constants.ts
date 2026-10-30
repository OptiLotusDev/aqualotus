
/** Depth layer of a code fragment — drives size, opacity, and weight. */
export type Depth = "far" | "mid" | "near";

export interface CodeSlot {
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
export const CODE_SLOTS: readonly CodeSlot[] = [
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
export const TIMING = {
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
