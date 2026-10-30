/**
 * Application toolbar (appbar): version, runtime status, undo/redo,
 * theme toggle, run button, and panel toggle buttons.
 *
 * Extracted from `AppShell.tsx` to keep the shell focused on workspace
 * composition rather than individual chrome controls.
 */

import type { ReactElement } from "react";
import type { RuntimeStatus } from "../hooks/useRuntime";
import { LIGHT_MODE_UNAVAILABLE_REASON } from "../hooks/useTheme";
import RevealText from "./RevealText";
import { breadcrumbPath } from "../lib/workspace";
import { displayVersion } from "../lib/app_shell_helpers";

const APP_NAME = "OptiLotus";

interface AppToolbarProps {
  readonly runtime: RuntimeStatus;
  readonly selectedName: string | null;
  readonly theme: string;
  readonly lightModeAvailable: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoTitle: string;
  readonly redoTitle: string;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToggleTheme: () => void;
  readonly onRun: () => void;
  readonly onToggleLeft: () => void;
  readonly onToggleInsp: () => void;
  readonly onOpenNav: () => void;
  readonly onOpenSheet: () => void;
  readonly isMobile: boolean;
  readonly leftOpen: boolean;
  readonly inspOpen: boolean;
  readonly programBusy: boolean;
  readonly programRunning: boolean;
  readonly selectedId: number | null;
  readonly leftPanelLabel: string;
}

export function AppToolbar(props: AppToolbarProps): ReactElement {
  const {
    runtime,
    selectedName,
    theme,
    lightModeAvailable,
    canUndo,
    canRedo,
    undoTitle,
    redoTitle,
    onUndo,
    onRedo,
    onToggleTheme,
    onRun,
    onToggleLeft,
    onToggleInsp,
    onOpenNav,
    onOpenSheet,
    isMobile,
    leftOpen,
    inspOpen,
    programBusy,
    programRunning,
    selectedId,
    leftPanelLabel,
  } = props;

  return (
    <header className="appbar enter-down enter-delay-toolbar">
      {isMobile ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm icon-btn"
          aria-label="Open blocks panel"
          onClick={onOpenNav}
        >
          ☰
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-panel btn-sm"
          aria-label="Toggle blocks panel"
          aria-pressed={leftOpen}
          onClick={onToggleLeft}
        >
          ☰ {leftPanelLabel}
        </button>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="appbar-title">
          Aqualotus <span className="appbar-version">v{__AQUALOTUS_VERSION__}</span>
        </div>
        <div className="appbar-sub">
          <RevealText
            text={selectedName !== null ? breadcrumbPath(selectedName) : "Visual programming"}
            delay={1150}
            stagger={45}
          />
        </div>
      </div>
      <div className="appbar-spacer" />
      <span
        className="status-dot enter-up enter-delay-status"
        data-state={runtime.phase === "ready" ? "ready" : "error"}
        role="status"
        title={
          runtime.phase === "ready"
            ? `Optilotus runtime ${runtime.version || "?"} · ${runtime.health || "?"}`
            : undefined
        }
      >
        <i aria-hidden="true" />
        {runtime.phase === "ready"
          ? `${APP_NAME} ${displayVersion(runtime.version)}`
          : runtime.phase === "loading"
            ? "Connecting…"
            : "Runtime unavailable"}
      </span>
      <div className="toolbar-group hide-compact">
        <button
          type="button"
          className="btn btn-ghost btn-sm icon-btn"
          disabled={!canUndo}
          onClick={onUndo}
          title={undoTitle}
          aria-label={undoTitle}
        >
          ⮪
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm icon-btn"
          disabled={!canRedo}
          onClick={onRedo}
          title={redoTitle}
          aria-label={redoTitle}
        >
          ⮫
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm icon-btn"
          aria-label={
            lightModeAvailable
              ? theme === "night"
                ? "Switch to light mode"
                : "Switch to night mode"
              : LIGHT_MODE_UNAVAILABLE_REASON
          }
          aria-pressed={theme === "light"}
          aria-disabled={lightModeAvailable ? undefined : true}
          disabled={!lightModeAvailable}
          onClick={onToggleTheme}
          title={
            lightModeAvailable
              ? theme === "night"
                ? "Light mode"
                : "Night mode"
              : LIGHT_MODE_UNAVAILABLE_REASON
          }
        >
          {theme === "night" ? "○" : "●"}
        </button>
      </div>
      {isMobile ? (
        <>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onOpenSheet}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm enter-up enter-delay-action"
            disabled={programBusy || programRunning || selectedId === null}
            onClick={onRun}
            aria-label="Run program"
          >
            ▶
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-panel btn-sm"
            aria-label="Toggle inspector"
            aria-pressed={inspOpen}
            onClick={onToggleInsp}
          >
            Inspector ◧
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm enter-up enter-delay-action"
            disabled={programBusy || programRunning || selectedId === null}
            onClick={onRun}
            title="Run (Ctrl/Cmd + Enter)"
          >
            ▶ Run
          </button>
        </>
      )}
    </header>
  );
}
