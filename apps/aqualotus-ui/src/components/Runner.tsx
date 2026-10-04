import type { ReactElement } from "react";
import type { CommandId, RunResult } from "../lib/optilotus";
import { errorMessage } from "../lib/program";

interface RunnerProps {
  readonly run: RunResult | null;
  readonly running: boolean;
  readonly durationMs: number | null;
  readonly errorId: CommandId | null;
  readonly onShowBlock: (id: CommandId) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Runner docked at the bottom of the central editor area (evolved from
 * the output panel). States: idle, running, success (with UI-measured
 * bridge duration), error. Failures link back to the offending block
 * via its stable command id.
 */
export default function Runner(props: RunnerProps): ReactElement {
  const { run, running, durationMs, errorId, onShowBlock } = props;

  return (
    <div>
      <div className="run-status" aria-live="polite">
        <span
          className="status-dot"
          data-state={
            running ? "busy" : run === null ? "idle" : run.status === "ok" ? "ready" : "error"
          }
          role="status"
        >
          <i aria-hidden="true" />
          {running
            ? "Running…"
            : run === null
              ? "Ready to run"
              : run.status === "ok"
                ? "Completed"
                : "Run failed"}
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
        {run === null && !running ? (
          <div className="notice">Run the program to see output here.</div>
        ) : null}
        {run !== null && run.status === "ok" && !running ? (
          <div>
            <div className="run-meta" style={{ marginBottom: 12 }}>
              <span>
                Steps <strong>{run.steps}</strong>
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
              <pre className="output-pre" aria-live="polite">
                {run.printed.map((line) => `> ${line}`).join("\n")}
              </pre>
            )}
          </div>
        ) : null}
        {run !== null && run.status === "error" && !running ? (
          <div className="notice notice-error" role="alert">
            <div className="notice-title">Run failed</div>
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
