import { useEffect, useState } from 'react'
import { formatDistanceStrict } from 'date-fns'
import { ArrowRight, ArrowLeft, Battery, Timer, Repeat, TriangleAlert } from 'lucide-react'
import { useLink } from '../store/link'
import Gauge from '../components/Gauge'
import { activeAlerts, assessLink, commLabels, commStyles, formatDuration } from '../lib/LinkStatus'
import type { Direction, UnitStatus } from '../types'

function DirectionCard({ title, icon: Icon, d }: { title: string; icon: typeof ArrowRight; d: Direction }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Icon size={18} className="text-sky-400" /> {title}
        </div>
        <span className={`flex items-center gap-1.5 text-xs ${d.connected ? 'text-emerald-400' : 'text-red-400'}`}>
          <span className={`h-2 w-2 rounded-full ${d.connected ? 'bg-emerald-400' : 'bg-red-500'}`} />
          {d.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-slate-400">Bitrate</dt><dd className="font-semibold tabular-nums">{d.bitrateKbps} kbps</dd></div>
        <div><dt className="text-xs text-slate-400">Latency</dt><dd className="font-semibold tabular-nums">{d.latencyMs} ms</dd></div>
        <div><dt className="text-xs text-slate-400">Jitter</dt><dd className="font-semibold tabular-nums">{d.jitterMs} ms</dd></div>
        <div><dt className="text-xs text-slate-400">Packet loss</dt><dd className="font-semibold tabular-nums">{d.packetLoss}%</dd></div>
      </dl>
    </div>
  )
}

function BatteryCard({ name, u }: { name: string; u: UnitStatus }) {
  const bar = u.battery < 20 ? 'bg-red-500' : u.battery < 40 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Battery size={18} className="text-sky-400" /> {name}
        </div>
        <span className={`text-xs ${u.online ? 'text-emerald-400' : 'text-red-400'}`}>{u.online ? 'Online' : 'Offline'}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${u.battery}%` }} />
      </div>
      <div className="mt-2 text-sm text-slate-300 tabular-nums">
        {u.battery.toFixed(0)}% · {u.voltage.toFixed(2)} V
      </div>
    </div>
  )
}

export default function Home() {
  const latest = useLink((s) => s.latest)
  const events = useLink((s) => s.events)
  const connected = useLink((s) => s.connected)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const level = assessLink(latest, connected, now)
  const alerts = activeAlerts(events, now)

  if (!latest) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="mt-2 text-slate-400">Waiting for data from the backend... Make sure <code>npm run dev</code> is running.</p>
      </div>
    )
  }

  const onFso = latest.activeChannel === 'FSO'
  const s = latest.session

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Home</h1>

      {/* Status row */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className={`rounded-xl border p-4 ${onFso ? 'border-sky-700 bg-sky-500/10 text-sky-300' : 'border-amber-600 bg-amber-500/10 text-amber-300'}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">Active channel</div>
          <div className="text-4xl font-bold">{latest.activeChannel}</div>
          <div className="text-xs opacity-80">{onFso ? 'Free-space optical (laser)' : 'LoRa radio fallback'}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Link state</div>
          <div className="text-4xl font-bold">{latest.linkState}</div>
        </div>
        <div className={`rounded-xl border p-4 ${commStyles[level]}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">Overall status</div>
          <div className="text-3xl font-bold">{commLabels[level]}</div>
        </div>
      </div>

      {/* Gauge + directions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold">FSO signal strength</h2>
          <Gauge value={latest.fso.rssi} markers={[30, 50]} label="RSSI (0-100)" />
          <p className="mt-1 text-center text-xs text-slate-400">Marks: failover below 30, locked at 50 or above</p>
        </div>
        <div className="grid gap-4 lg:col-span-2">
          <DirectionCard title="Unit A → Unit B" icon={ArrowRight} d={latest.ab} />
          <DirectionCard title="Unit B → Unit A" icon={ArrowLeft} d={latest.ba} />
        </div>
      </div>

      {/* Batteries + session + alerts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <BatteryCard name="Unit A" u={latest.units.A} />
        <BatteryCard name="Unit B" u={latest.units.B} />
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 font-semibold"><Timer size={18} className="text-sky-400" /> Session</div>
          <div className="mt-2 text-sm text-slate-300">Uptime: <span className="font-semibold tabular-nums">{formatDuration(s.uptimeSec)}</span></div>
          <div className="mt-1 flex items-center gap-1 text-sm text-slate-300">
            <Repeat size={14} /> Failovers: <span className="font-semibold">{s.failovers}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {s.lastFailoverTs
              ? `Last: ${s.lastFailoverReason}, ${formatDistanceStrict(s.lastFailoverTs, latest.ts)} ago`
              : 'No failover yet this session'}
          </div>
        </div>
        <div className={`rounded-xl border p-4 ${alerts.count ? 'border-amber-600 bg-amber-500/10' : 'border-slate-800 bg-slate-900'}`}>
          <div className="flex items-center gap-2 font-semibold"><TriangleAlert size={18} className={alerts.count ? 'text-amber-300' : 'text-sky-400'} /> Active alerts</div>
          <div className="mt-2 text-3xl font-bold tabular-nums">{alerts.count}</div>
          <div className="mt-1 text-xs text-slate-300">{alerts.worst ? alerts.worst.message : 'None in the last 5 minutes'}</div>
        </div>
      </div>
    </div>
  )
}