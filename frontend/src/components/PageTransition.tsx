import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

export default function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div className="relative">
      <div key={`scan-${pathname}`} aria-hidden className="scan-track">
        <div className="scan-line" />
      </div>
      <div key={pathname} className="page-wipe">
        {children}
      </div>
    </div>
  )
}