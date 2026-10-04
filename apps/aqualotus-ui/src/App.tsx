import { useCallback, useRef, type ReactElement } from "react";
import AppShell from "./components/AppShell";
import { useProgram } from "./hooks/useProgram";
import { useRuntime } from "./hooks/useRuntime";

/**
 * Application entry. Initializes the Optilotus bridge once via
 * `useRuntime`, then projects the package through `useProgram`.
 * The runtime stays authoritative; React owns selection and layout.
 * The sequence counter orders semantic undo entries against the
 * shell's view-undo entries for one unified undo/redo.
 */
function App(): ReactElement {
  const { status, retry } = useRuntime();
  const seqRef = useRef<number>(0);
  const issueSeq = useCallback((): number => {
    seqRef.current += 1;
    return seqRef.current;
  }, []);
  const program = useProgram(status.phase === "ready", issueSeq);

  if (status.phase === "loading") {
    return (
      <main className="boot" aria-label="Loading">
        <div className="boot-card">
          <div className="appbar-title">Aqualotus</div>
          <div className="skeleton" aria-hidden="true" />
          <p style={{ color: "var(--text-secondary)" }}>
            Connecting to the Optilotus runtime…
          </p>
        </div>
      </main>
    );
  }

  if (status.phase === "failed") {
    return (
      <main className="boot" aria-label="Runtime unavailable">
        <div className="boot-card">
          <div className="appbar-title">Aqualotus</div>
          <div className="notice notice-error" role="alert">
            <div className="notice-title">Runtime unavailable</div>
            <div>
              The Optilotus runtime could not start. {status.error}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={retry}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <AppShell
      runtime={status}
      program={program.snapshot}
      issueSeq={issueSeq}
      canUndo={program.canUndo}
      canRedo={program.canRedo}
      undoLabel={program.undoLabel}
      redoLabel={program.redoLabel}
      undoSeq={program.undoSeq}
      redoSeq={program.redoSeq}
      onUndo={program.undo}
      onRedo={program.redo}
      onSelectFunction={program.selectFunction}
      onSelectCommand={program.selectCommand}
      onCreateFunction={program.createFunction}
      onDeleteFunction={program.deleteFunction}
      onAddCommand={program.addCommand}
      onReplaceCommand={program.replaceCommand}
      onDeleteCommand={program.deleteCommand}
      onApplyLinks={program.applyLinks}
      onRun={program.run}
      onDismissError={program.dismissError}
    />
  );
}

export default App;
