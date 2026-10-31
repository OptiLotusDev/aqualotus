import { useState, type FormEvent, type ReactElement } from "react";
import type {
  CommandId,
  OptilotusType,
  RunResult,
  Value,
} from "../lib/optilotus";
import { errorFields } from "../lib/errors";
import { errorMessage } from "../lib/program";

interface RunnerProps {
  readonly run: RunResult | null;
  readonly running: boolean;
  /**
   * The paused resumable run: the `input` command it waits on and the
   * type it expects. `null`/absent when no run waits for input.
   */
  readonly pendingInput?: {
    readonly command: CommandId;
    readonly ty: OptilotusType;
  } | null;
  readonly durationMs: number | null;
  /**
   * The **visible** block the failure points at, or `null` when the
   * failure cannot be attributed to a block the canvas knows.
   *
   * The runner offers the navigation action only for a resolved
   * target: the engine's own id names an internal node, and a button
   * that leads to no block would be a lie.
   */
  readonly errorId: CommandId | null;
  readonly busy?: boolean;
  readonly canRun?: boolean;
  readonly onShowBlock: (id: CommandId) => void;
  readonly onRun?: () => void;
  /** Feed one line to the paused run. */
  readonly onSubmitInput?: (value: string) => void;
  /** Abandon the paused run (its output is not produced). */
  readonly onCancelRun?: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Readable rendering of the engine's tagged `Value` union. */
function formatValue(value: Value): string {
  if (value === "Void") return "Void";
  const entry = Object.entries(value)[0];
  if (entry === undefined) return "?";
  const [tag, raw] = entry;
  if (typeof raw === "string") return `${tag} ${JSON.stringify(raw)}`;
  return `${tag} ${String(raw)}`;
}

/**
 * One prompt for one paused run. The parent keys it by the pending
 * command, so a new pause mounts a fresh (empty) field without an
 * effect.
 */
function InputPrompt(props: {
  readonly ty: OptilotusType;
  readonly busy?: boolean;
  readonly onSubmit?: (value: string) => void;
  readonly onCancelRun?: () => void;
}): ReactElement {
  const [value, setValue] = useState<string>("");

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (props.onSubmit === undefined) return;
    props.onSubmit(value);
    setValue("");
  }

  return (
    <form className="notice" data-testid="runner-input" onSubmit={submit}>
      <div className="notice-title">Input needed · {props.ty}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          aria-label="Run input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`${props.ty} value`}
          autoFocus
          autoComplete="off"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={props.busy === true}
        >
          Submit
        </button>
        {props.onCancelRun !== undefined ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={props.onCancelRun}
          >
            Cancel run
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Runner panel: one clearly identifiable place for execution status,
 * printed output, duration, and runtime errors (Issue 11). Status is
 * icon + text (never color alone); stale output is impossible because
 * every program refresh clears the result upstream. Empty, running,
 * success, and failure states each render explicitly.
 */
export default function Runner(props: RunnerProps): ReactElement {
  const {
    run,
    running,
    pendingInput,
    durationMs,
    errorId,
    busy,
    canRun,
    onShowBlock,
    onRun,
    onSubmitInput,
    onCancelRun,
  } = props;
  const waiting = pendingInput !== undefined && pendingInput !== null;
  const state = waiting
    ? "busy"
    : running
      ? "busy"
      : run === null
        ? "idle"
        : run.status === "ok"
          ? "ready"
          : "error";
  const statusIcon = waiting
    ? "?"
    : running
      ? "…"
      : run === null
        ? "○"
        : run.status === "ok"
          ? "✓"
          : "✗";
  const statusText = waiting
    ? "Waiting for input"
    : running
      ? "Running…"
      : run === null
        ? "Ready to run"
        : run.status === "ok"
          ? "Completed"
          : "Run failed";

  return (
    <div data-testid="runner-panel">
      <div className="run-head">
        <span className="pane-title">Runner</span>
        {onRun !== undefined ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={running || waiting || busy === true || canRun === false}
            onClick={onRun}
            title="Run (Ctrl/Cmd + Enter)"
            aria-label="Run program"
          >
            ▶ Run
          </button>
        ) : null}
      </div>
      <div className="run-status" aria-live="polite" data-testid="runner-status" data-state={state}>
        <span
          className="status-dot"
          data-state={state}
          role="status"
        >
          <i aria-hidden="true" />
          <span aria-hidden="true">{statusIcon}</span>
          {statusText}
        </span>
        {durationMs !== null && !running && !waiting ? (
          <span
            className="run-duration"
            title="UI-measured bridge round-trip, not runtime CPU time"
          >
            {formatDuration(durationMs)}
          </span>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }}>
        {waiting ? (
          <InputPrompt
            key={pendingInput.command}
            ty={pendingInput.ty}
            busy={busy}
            onSubmit={onSubmitInput}
            onCancelRun={onCancelRun}
          />
        ) : null}
        {running ? (
          <div className="notice" data-testid="runner-running">
            <div className="skeleton" aria-hidden="true" />
            <span>Executing main…</span>
          </div>
        ) : null}
        {run === null && !running && !waiting ? (
          <div className="notice" data-testid="runner-empty">Run the program to see output here.</div>
        ) : null}
        {run !== null && run.status === "ok" && !running && !waiting ? (
          <div data-testid="runner-success">
            <div className="run-meta" style={{ marginBottom: 12 }}>
              <span>
                <span aria-hidden="true">✓ </span>Steps <strong>{run.steps}</strong>
              </span>
              <span>
                Prints <strong>{run.prints}</strong>
              </span>
              {run.returned !== null && run.returned !== undefined ? (
                <span data-testid="runner-returned">
                  Returned <strong>{formatValue(run.returned)}</strong>
                </span>
              ) : null}
            </div>
            {run.printed.length === 0 ? (
              <div className="notice notice-ok">
                Run completed — no printed output.
              </div>
            ) : (
              <pre className="output-pre" aria-live="polite" aria-label="Program output">
                {run.printed.map((line) => `> ${line}`).join("\n")}
              </pre>
            )}
          </div>
        ) : null}
        {run !== null && run.status === "error" && !running && !waiting ? (
          <div className="notice notice-error" role="alert" data-testid="runner-error">
            <div className="notice-title"><span aria-hidden="true">✗ </span>Run failed</div>
            {/* The engine's error family and message, unchanged. */}
            <div data-testid="runner-error-message">{errorMessage(run)}</div>
            {/* The kind-specific fields the engine sent (the expected
                arity, the missing variable, the step budget, …) stay
                visible instead of being flattened into the message. */}
            {errorFields(run).map((field) => (
              <div
                key={field.label}
                data-testid={`runner-error-field-${field.label.toLowerCase()}`}
              >
                {field.label}: {field.value}
              </div>
            ))}
            {typeof errorId === "number" ? (
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => onShowBlock(errorId)}
              >
                Show block #{errorId}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
