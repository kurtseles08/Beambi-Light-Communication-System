import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TriangleAlert, Crosshair, Radio,
  CloudSun, ShieldCheck, ScrollText, Settings,
} from 'lucide-react'

const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/disaster', label: 'Disaster Status', icon: TriangleAlert },
  { to: '/alignment', label: 'Alignment', icon: Crosshair },
  { to: '/link', label: 'Link Details', icon: Radio },
  { to: '/environment', label: 'Environment', icon: CloudSun },
  { to: '/security', label: 'Security', icon: ShieldCheck },
  { to: '/logs', label: 'Logs & Analytics', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:w-60">
      <div className="flex h-16 items-center justify-center border-b border-slate-800 px-4 md:justify-start">
        <span className="text-lg font-bold text-sky-400 md:hidden">B</span>
        <span className="hidden text-lg font-bold text-sky-400 md:inline">BeamBi</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={label}
            className={({ isActive }) =>
              `flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition md:justify-start ${
                isActive
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              }`
            }
          >
            <Icon size={20} />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}