"use client"
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false) // Default to false or a sensible default

  React.useEffect(() => {
    // This function will only run on the client side
    const updateMobileState = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Set initial state
    updateMobileState()

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", updateMobileState)
    
    return () => mql.removeEventListener("change", updateMobileState)
  }, [])

  return isMobile
}
