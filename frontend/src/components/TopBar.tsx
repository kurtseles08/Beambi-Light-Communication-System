import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Pin } from 'lucide-react'
import { useHazards } from '../store/hazards'
import { useLink } from '../store/link'
import { assess, type Level } from '../lib/hazardStatus'
import { assessLink, commLabels, type CommLevel } from '../lib/linkStatus'
import { useNow } from '../hooks/useNow'
import Lamp, { type LampLevel } from './Lamp'

const linkLamp: Record<CommLevel, LampLevel> = {
  normal: 'ok',
  degraded: 'warn',
  emergency: 'crit',
  offline: 'off',
}

const hazardLamp: Record<Level, LampLevel> = {
  normal: 'ok',
  watch: 'warn',
  warning: 'crit',
  unknown: 'off',
}

function Indicator({ to, label, value, level }: { to: string; label: string; value: string; level: LampLevel }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-lg bg-forest-800 px-3 py-2 text-mint-100 transition-colors hover:bg-forest-700"
    >
      <Lamp level={level} />
      <span className="text-[13px] text-mint-100/70">{label}</span>
      <span className="text-[13px] font-medium">{value}</span>
    </Link>
  )
}

type Props = { pinned: boolean; onTogglePin: () => void }

export default function TopBar({ pinned, onTogglePin }: Props) {
  const nowMs = useNow()
  const now = new Date(nowMs)

  const weather = useHazards((s) => s.weather)
  const quakes = useHazards((s) => s.quakes)
  const latest = useLink((s) => s.latest)
  const connected = useLink((s) => s.connected)
  const source = useLink((s) => s.source)

  const hazard = assess(weather, quakes)
  const link = assessLink(latest, connected, nowMs)

  // Military date-time group, zone H = UTC+8
  const dtg = `${format(now, 'ddHHmm')}H ${format(now, 'MMM yy').toUpperCase()}`

  const dataLevel: LampLevel = !connected ? 'crit' : source === 'simulator' ? 'warn' : 'ok'
  const dataValue = !connected ? 'Disconnected' : source === 'simulator' ? 'Simulated' : 'Live'

  return (
    <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-forest-900/10 bg-mint-50/60 px-6 py-3">
      <div className="flex items-center gap-4">
        <button
          onClick={onTogglePin}
          aria-pressed={pinned}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          className={`grid h-9 w-9 place-items-center rounded-lg border transition-colors ${
            pinned
              ? 'border-forest-800 bg-forest-800 text-white'
              : 'border-forest-900/15 bg-white text-forest-800 hover:bg-mint-200'
          }`}
        >
          <Pin size={16} />
        </button>
        <div className="font-mono text-2xl font-medium tabular-nums">{format(now, 'HH:mm:ss')}</div>
        <div className="border-l border-forest-900/15 pl-4 leading-tight">
          <div className="font-mono text-[13px] text-moss-600">{dtg}</div>
          <div className="text-[13px] text-moss-600">{format(now, 'EEEE, d MMMM yyyy')}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Indicator to="/" label="Link" value={commLabels[link]} level={linkLamp[link]} />
        <Indicator to="/disaster" label="Hazard" value={hazard.label} level={hazardLamp[hazard.level]} />
        <Indicator to="/debug" label="Data" value={dataValue} level={dataLevel} />
      </div>
    </header>
  )
}