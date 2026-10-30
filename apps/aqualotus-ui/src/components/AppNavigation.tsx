/**
 * Mobile drawer / sheet navigation: blocks panel and inspector sheet
 * shown on compact viewports.
 *
 * Extracted from `AppShell.tsx`.
 */

import type { ReactElement } from "react";

interface AppNavigationProps {
  readonly isMobile: boolean;
  readonly navOpen: boolean;
  readonly sheetOpen: boolean;
  readonly onNavClose: () => void;
  readonly onSheetClose: () => void;
  readonly leftPanel: ReactElement;
  readonly inspector: ReactElement;
}

export function AppNavigation(props: AppNavigationProps): ReactElement {
  const {
    isMobile,
    navOpen,
    sheetOpen,
    onNavClose,
    onSheetClose,
    leftPanel,
    inspector,
  } = props;

  if (!isMobile) return <></>;
  return (
    <>
      {navOpen ? (
        <>
          <div className="scrim" onClick={onNavClose} aria-hidden="true" />
          <nav className="drawer" aria-label="Blocks and functions">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h2 className="pane-title">Blocks</h2>
              <div className="appbar-spacer" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onNavClose}
                aria-label="Close block library"
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: 4 }}>{leftPanel}</div>
          </nav>
        </>
      ) : null}

      {sheetOpen ? (
        <>
          <div className="scrim" onClick={onSheetClose} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Inspector">
            <div className="sheet-grip" aria-hidden="true" />
            {inspector}
            <button
              type="button"
              className="btn"
              style={{ marginTop: 16, width: "100%" }}
              onClick={onSheetClose}
            >
              Done
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
