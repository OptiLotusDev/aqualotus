import { useIsMobile } from './hooks/useIsMobile'
import DesktopLayout from './layouts/DesktopLayout'
import MobileLayout from './layouts/MobileLayout'

/**
 * Single shared app entry. Layout (not app) switches per target:
 * narrow viewport or Capacitor native shell → MobileLayout,
 * otherwise → DesktopLayout. Both share the Optilotus WASM bridge.
 */
function App() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileLayout /> : <DesktopLayout />
}

export default App
