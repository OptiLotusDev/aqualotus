import type { ReactElement } from "react";
import type { CommandId, RunResult } from "../lib/optilotus";
import { errorMessage } from "../lib/program";

interface RunnerProps {
  readonly run: RunResult | null;
  readonly running: boolean;
  readonly durationMs: number | null;
  readonly errorId: CommandId | null;
  readonly busy?: boolean;
  readonly canRun?: boolean;
  readonly onShowBlock: (id: CommandId) => void;
  readonly onRun?: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
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
    durationMs,
    errorId,
    busy,
    canRun,
    onShowBlock,
    onRun,
  } = props;
  const state = running
    ? "busy"
    : run === null
      ? "idle"
      : run.status === "ok"
        ? "ready"
        : "error";
  const statusIcon = running ? "…" : run === null ? "○" : run.status === "ok" ? "✓" : "✗";
  const statusText = running
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
            disabled={running || busy === true || canRun === false}
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
        {durationMs !== null && !running ? (
          <span
            className="run-duration"
            title="UI-measured bridge round-trip, not runtime CPU time"
          >
            {formatDuration(durationMs)}
          </span>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }}>
        {running ? (
          <div className="notice" data-testid="runner-running">
            <div className="skeleton" aria-hidden="true" />
            <span>Executing main…</span>
          </div>
        ) : null}
        {run === null && !running ? (
          <div className="notice" data-testid="runner-empty">Run the program to see output here.</div>
        ) : null}
        {run !== null && run.status === "ok" && !running ? (
          <div data-testid="runner-success">
            <div className="run-meta" style={{ marginBottom: 12 }}>
              <span>
                <span aria-hidden="true">✓ </span>Steps <strong>{run.steps}</strong>
              </span>
              <span>
                Prints <strong>{run.prints}</strong>
              </span>
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
        {run !== null && run.status === "error" && !running ? (
          <div className="notice notice-error" role="alert" data-testid="runner-error">
            <div className="notice-title"><span aria-hidden="true">✗ </span>Run failed</div>
            <div>{errorMessage(run)}</div>
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
