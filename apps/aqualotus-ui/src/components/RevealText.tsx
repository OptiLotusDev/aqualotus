import { useEffect, useRef, useState, type ReactElement } from "react";

interface RevealTextProps {
  /** Text to reveal. Words are split on spaces. */
  readonly text: string;
  /** Delay before the first word appears, in milliseconds. */
  readonly delay?: number;
  /** Delay between consecutive words, in milliseconds. */
  readonly stagger?: number;
  /** Class applied to every word. */
  readonly wordClassName?: string;
}

/**
 * Word-by-word reveal for presentation text (titles, subtitles,
 * empty-state copy). Purely decorative: the full text stays in the
 * accessibility tree and in the DOM from the first paint, so search,
 * copy, and screen readers are unaffected by the animation.
 *
 * The animation is CSS-driven and runs once per mounted word — React
 * re-renders never restart it, and the reduced-motion preference
 * collapses it to an instant reveal. The opening delay only applies
 * to the first text: when the content itself changes (a different
 * function is selected, say) the new words cascade in immediately
 * instead of leaving the line blank for the opening delay.
 */
export default function RevealText(props: RevealTextProps): ReactElement {
  const { text, delay = 0, stagger = 55, wordClassName = "reveal-word" } = props;
  const [startDelay, setStartDelay] = useState<number>(delay);
  const shownText = useRef<string>(text);

  useEffect(() => {
    if (shownText.current === text) return;
    shownText.current = text;
    setStartDelay(0);
  }, [text]);

  const words = text.split(" ").filter((word) => word !== "");
  return (
    <span className="reveal-words">
      {words.map((word, index) => (
        <span key={`${index}-${word}`}>
          <span
            className={wordClassName}
            style={{ animationDelay: `${startDelay + index * stagger}ms` }}
          >
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
