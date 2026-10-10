import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TriangleAlert, Crosshair, Radio, CloudSun,
  ShieldCheck, ScrollText, Settings, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Item = { to: string; label: string; icon: LucideIcon }

const groups: { title: string; items: Item[] }[] = [
  {
    title: 'Monitor',
    items: [
      { to: '/', label: 'Home', icon: LayoutDashboard },
      { to: '/alignment', label: 'Alignment', icon: Crosshair },
      { to: '/link', label: 'Link Details', icon: Radio },
    ],
  },
  {
    title: 'Situation',
    items: [
      { to: '/disaster', label: 'Disaster Status', icon: TriangleAlert },
      { to: '/environment', label: 'Environment', icon: CloudSun },
    ],
  },
  {
    title: 'Control',
    items: [
      { to: '/security', label: 'Security', icon: ShieldCheck },
      { to: '/logs', label: 'Logs & Analytics', icon: ScrollText },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

type Props = {
  open: boolean
  onPointerEnter: (e: ReactPointerEvent) => void
  onFocus: () => void
}

export default function Sidebar({ open, onPointerEnter, onFocus }: Props) {
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null)

  // Measure the active tab so the highlight can slide to it
  const measure = useCallback(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    setBar(el ? { top: el.offsetTop, height: el.offsetHeight } : null)
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [pathname, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return (
    <aside className="sidebar-glass" data-open={open} onPointerEnter={onPointerEnter} onFocus={onFocus}>
      {/* Brand */}
      <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
        <img src="/logo-light.png" alt="BeamBi logo" className="logo-glow h-24 w-24" />
        <div className="mt-3 font-stencil text-3xl tracking-[0.16em] text-white">BEAMBI</div>
        <div className="mt-1 text-xs font-medium uppercase tracking-[0.22em] text-leaf-400">FSOC Dashboard</div>
      </div>
      <div className="mx-5 border-t border-white/15" />

      {/* Navigation */}
      <nav ref={navRef} className="relative flex-1 overflow-y-auto pb-4 pt-4">
        {bar && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 top-0 z-0 rounded-xl bg-mint-100 shadow-lg transition-[transform,height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateY(${bar.top}px)`, height: bar.height }}
          />
        )}
        {groups.map((g) => (
          <div key={g.title} className="mb-4">
            <div className="mb-1 px-6 font-display text-xs font-semibold uppercase tracking-[0.2em] text-leaf-400">
              {g.title}
            </div>
            {g.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `relative z-10 mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors duration-300 ${
                    isActive ? 'text-forest-900' : 'text-white/85 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} className={isActive ? 'text-forest-700' : 'text-leaf-400'} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Handle arrow, visible only while the sidebar is tucked away */}
      <span
        aria-hidden
        className={`pointer-events-none absolute right-1 top-1/2 z-20 -translate-y-1/2 text-white/80 transition-opacity duration-300 ${
          open ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <ChevronRight size={16} />
      </span>
    </aside>
  )
}