import { useEffect, useState } from 'react'
import { isNativeMobile } from './capacitorBridge'

const MOBILE_QUERY = '(max-width: 767px)'

/**
 * Layout selection hook: mobile when the viewport is narrow or the app
 * runs inside a Capacitor native shell; desktop otherwise.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_QUERY).matches ||
        isNativeMobile(window)
      : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mql.matches || isNativeMobile(window))
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return mobile
}
