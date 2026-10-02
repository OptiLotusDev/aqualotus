import type { ReactElement } from 'react'
import { useOptilotus } from '../hooks/useOptilotus'

/**
 * Shared Optilotus status panel (presentational only; state lives in
 * `useOptilotus`). Rendered by both DesktopLayout and MobileLayout so
 * the WASM bridge stays visible on every target.
 */
export default function OptilotusPanel(): ReactElement {
  const status = useOptilotus()

  return (
    <section id="optilotus" style={{ padding: '2rem', textAlign: 'left' }}>
      <h2>Optilotus (WASM)</h2>
      <p>
        Status: <code>{status.wasmStatus}</code>
      </p>
      <ul>
        <li>
          version: <code>{status.version || '…'}</code>
        </li>
        <li>
          health: <code>{status.health || '…'}</code>
        </li>
        <li>
          execMath("(3 + 4) % 2"): <code>{status.mathDemo || '…'}</code>
        </li>
      </ul>
    </section>
  )
}
