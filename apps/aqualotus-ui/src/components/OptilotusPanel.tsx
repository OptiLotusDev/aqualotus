import { useEffect, useState } from 'react'
import {
  add,
  ensureOptilotus,
  getEmptyProgram,
  getHealth,
  getVersion,
  runEmpty,
} from '../lib/optilotus'

/**
 * Shared Optilotus status panel. Rendered by both DesktopLayout and
 * MobileLayout so the WASM bridge stays visible on every target
 * (Web, Tauri desktop, Capacitor mobile).
 */
export default function OptilotusPanel() {
  const [wasmStatus, setWasmStatus] = useState('loading Optilotus WASM…')
  const [version, setVersion] = useState('')
  const [health, setHealth] = useState('')
  const [emptyProgram, setEmptyProgram] = useState('')
  const [runResult, setRunResult] = useState('')
  const [addResult, setAddResult] = useState('')

  useEffect(() => {
    ensureOptilotus()
      .then(() => {
        setVersion(getVersion());
        setHealth(getHealth());
        setEmptyProgram(getEmptyProgram());
        setRunResult(runEmpty());
        setAddResult(String(add(2, 3)));
        setWasmStatus('connected');
      })
      .catch((e) => {
        setWasmStatus(`failed: ${String(e)}`);
      });
  }, [])

  return (
    <section id="optilotus" style={{ padding: '2rem', textAlign: 'left' }}>
      <h2>Optilotus (WASM)</h2>
      <p>
        Status: <code>{wasmStatus}</code>
      </p>
      <ul>
        <li>
          version: <code>{version || '…'}</code>
        </li>
        <li>
          health: <code>{health || '…'}</code>
        </li>
        <li>
          add(2, 3): <code>{addResult || '…'}</code>
        </li>
        <li>
          empty program: <code>{emptyProgram || '…'}</code>
        </li>
        <li>
          run empty: <code>{runResult || '…'}</code>
        </li>
      </ul>
    </section>
  )
}
