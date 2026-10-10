import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import StatusBar from './StatusBar'
import { useHazards } from '../store/hazards'
import { useLink } from '../store/link'

const isMouse = (e: ReactPointerEvent) => e.pointerType === 'mouse'

export default function Layout() {
  const refresh = useHazards((s) => s.refresh)
  const connect = useLink((s) => s.connect)
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [pinned, setPinned] = useState(false)

  // Pin keeps the sidebar open; unpin tucks it away until the mouse returns to the edge
  const togglePin = () => {
    setPinned(!pinned)
    setOpen(!pinned)
  }

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  // Start each page at the top
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="app-backdrop relative h-dvh overflow-hidden p-3">
      {/* Soft glows so the glass sidebar has something to blur */}
      <div aria-hidden className="pointer-events-none absolute -left-24 top-10 h-96 w-96 rounded-full bg-leaf-400/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-24 h-96 w-96 rounded-full bg-forest-700/80 blur-3xl" />

      {/* Hover zone on the left edge */}
      <div
        className="fixed inset-y-0 left-0 z-30 w-6"
        onPointerEnter={(e) => isMouse(e) && setOpen(true)}
      />

      <Sidebar
        open={open}
        onPointerEnter={(e) => isMouse(e) && setOpen(true)}
        onFocus={() => setOpen(true)}
      />

      <div className="shell h-full" data-open={open}>
        <div
          className="flex h-full flex-col overflow-hidden rounded-3xl bg-mint-100 text-forest-900 shadow-2xl ring-1 ring-black/20"
          onPointerEnter={(e) => isMouse(e) && !pinned && setOpen(false)}
        >
          <TopBar pinned={pinned} onTogglePin={togglePin} />
          <main ref={mainRef} className="flex-1 overflow-y-auto p-6">
            <div key={pathname}>
              <Outlet />
            </div>
          </main>
          <StatusBar />
        </div>
      </div>
    </div>
  )
}