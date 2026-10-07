import { useEffect, useState } from 'react'
import { format } from 'date-fns'

export default function TopBar() {
  const [now, setNow] = useState(new Date())

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
        <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">
          Disaster status: --
        </span>
        <span className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          Backend: not connected
        </span>
      </div>
    </header>
  )
}