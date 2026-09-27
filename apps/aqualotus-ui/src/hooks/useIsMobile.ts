import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

interface CapacitorWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean
  }
}

/** True when running inside a Capacitor native shell. */
function isNativeMobile(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      (window as unknown as CapacitorWindow).Capacitor?.isNativePlatform?.() ??
      false
    )
  } catch {
    return false
  }
}

/**
 * Layout selection hook: mobile when the viewport is narrow or the app
 * runs inside a Capacitor native shell; desktop otherwise.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_QUERY).matches || isNativeMobile()
      : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mql.matches || isNativeMobile())
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return mobile
}
