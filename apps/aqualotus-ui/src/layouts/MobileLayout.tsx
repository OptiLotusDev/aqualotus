import type { ReactElement } from 'react'
import OptilotusPanel from '../components/OptilotusPanel'

/**
 * Phone shell: compact stacked layout rendering the same shared
 * Optilotus bridge panel. Loaded for narrow viewports and inside the
 * Capacitor native shell.
 */
export default function MobileLayout(): ReactElement {
  return (
    <main
      style={{
        maxWidth: '480px',
        margin: '0 auto',
        padding: '1rem',
        textAlign: 'left',
      }}
    >
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Aqualotus</h1>
        <p style={{ margin: '0.25rem 0 0' }}>Mobile layout (shared UI)</p>
      </header>
      <OptilotusPanel />
    </main>
  )
}
