import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { useHazards } from '../store/hazards'
import { assess, levelStyles } from '../lib/hazardStatus'

export default function TopBar() {
  const [now, setNow] = useState(new Date())
  const weather = useHazards((s) => s.weather)
  const quakes = useHazards((s) => s.quakes)
  const status = assess(weather, quakes)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 backdrop-blur">
      <div>
        <div className="text-xl font-semibold tabular-nums">{format(now, 'hh:mm:ss a')}</div>
        <div className="text-xs text-slate-400">{format(now, 'EEEE, MMMM d, yyyy')}</div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/disaster"
          className={`rounded-full border px-3 py-1 text-xs ${levelStyles[status.level]}`}
        >
          Disaster status: {status.label}
        </Link>
        <span className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          Backend: not connected
        </span>
      </div>
    </header>
  )
}