import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from './App.tsx'
import FluidBackdrop from './components/FluidBackdrop.tsx'

// The atmospheric backdrop is a sibling of the app, not a child: it
// paints behind every screen (boot, editor, failure state) and never
// receives pointer or touch events.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FluidBackdrop />
    <App />
  </StrictMode>,
)
