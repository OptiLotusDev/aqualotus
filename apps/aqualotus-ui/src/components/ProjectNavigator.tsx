import { useState, type ReactElement } from "react";
import type { FunctionId, FunctionSummary } from "../lib/optilotus";
import {
  PACKAGE_NAME,
  PRESENTATION_STRUCT_NAME,
  breadcrumbPath,
} from "../lib/workspace";
import FunctionBrowser from "./FunctionBrowser";
import BlockLibrary from "./BlockLibrary";

interface ProjectNavigatorProps {
  readonly functions: readonly FunctionSummary[];
  readonly selectedId: FunctionId | null;
  readonly busy: boolean;
  readonly onSelect: (id: FunctionId) => void;
  readonly onDelete: (id: FunctionId) => void;
  readonly libraryBusy: boolean;
  readonly onAddBlock: (kind: string) => void;
  readonly onClearPackage: () => void;
  readonly onDropToCanvas: (
    kind: string,
    clientX: number,
    clientY: number,
  ) => void;
}

/**
 * Hierarchical project navigator + toolbox. Composes the existing
 * function browser and block library under a Package → Struct →
 * Function tree so the left panel reads as one project, not two
 * unrelated lists. Runtime-backed rows stay inside the composed
 * components; only the grouping headers are presentation-only.
 */
export default function ProjectNavigator(
  props: ProjectNavigatorProps,
): ReactElement {
  const {
    functions,
    selectedId,
    busy,
    onSelect,
    onDelete,
    libraryBusy,
    onAddBlock,
    onClearPackage,
    onDropToCanvas,
  } = props;
  const selected = functions.find((f) => f.id === selectedId) ?? null;
  // Destructive reset needs an explicit second click (no timers, no
  // native dialogs): arm shows the confirm pair, cancel disarms.
  const [armingReset, setArmingReset] = useState<boolean>(false);
  return (
    <div className="left-stack">
      <section aria-label="Project">
        <div className="pane-head">
          <h2 className="pane-title">Project</h2>
        </div>
        <div className="pane-body">
          <nav className="proj-tree" aria-label="Package structure">
            <div className="proj-pkg">
              <span className="proj-label">Package</span>
              <span className="proj-name">{PACKAGE_NAME}</span>
            </div>
            <div className="proj-struct">
              <span className="proj-label proj-label-struct">Struct</span>
              <span className="proj-name">{PRESENTATION_STRUCT_NAME}</span>
              <span className="preview-badge">Preview</span>
            </div>
            <div className="proj-path" title="Current selection path">
              {breadcrumbPath(selected?.name ?? null)}
            </div>
            {armingReset ? (
              <div className="proj-reset-confirm">
                <span>Reset the whole project?</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() => {
                      setArmingReset(false);
                      onClearPackage();
                    }}
                  >
                    Yes, reset
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setArmingReset(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                disabled={busy}
                onClick={() => setArmingReset(true)}
              >
                Reset project
              </button>
            )}
          </nav>
        </div>
      </section>
      <section aria-label="Blocks">
        <div className="pane-head">
          <h2 className="pane-title">Blocks</h2>
        </div>
        <div className="pane-body">
          <FunctionBrowser
            functions={functions}
            selectedId={selectedId}
            busy={busy}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        </div>
      </section>
      <section aria-label="Block library">
        <div className="pane-head">
          <h2 className="pane-title">Library</h2>
        </div>
        <div className="pane-body">
          <BlockLibrary
            busy={libraryBusy}
            onAdd={onAddBlock}
            onDropToCanvas={onDropToCanvas}
          />
        </div>
      </section>
    </div>
  );
}
