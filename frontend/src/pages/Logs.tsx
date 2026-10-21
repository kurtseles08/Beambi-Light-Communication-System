import { useTelemetry } from '../hooks/useTelemetry'
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { format } from 'date-fns'
import { Download, Play, Search, Square } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import { Big, Pill, Row, SourceTag, Sub, toneChip, type Tone } from '../components/ui'
import { formatDuration } from '../lib/linkStatus'
import { downloadCsv } from '../lib/csv'
import type { LinkEvent, Run, Sample, Severity } from '../types'

const idx = (i: number) => ({ '--i': i }) as CSSProperties
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'

// ---------- history from the backend ----------

function useHistory(minutes: number, everyMs: number) {
  const [samples, setSamples] = useState<Sample[]>([])
  const [persistence, setPersistence] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/history?minutes=${minutes}`)
        if (!res.ok) throw new Error(`The backend answered ${res.status}`)
        const d: { samples: Sample[]; persistence: string } = await res.json()
        if (!alive) return
        setSamples(d.samples)
        setPersistence(d.persistence)
        setError(null)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Request failed')
      }
    }
    void load()
    const id = setInterval(load, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [minutes, everyMs])

  return { samples, persistence, error }
}

const RANGES = [
  { minutes: 5, label: '5 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '24 hours' },
] as const

function ChartTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
        active ? 'border-forest-800 bg-forest-800 text-white' : 'border-forest-900/15 bg-white text-forest-800 hover:bg-mint-200'}`}>
      {children}
    </button>
  )
}

const SEV: Severity[] = ['Info', 'Warning', 'Critical']
const sevTone: Record<Severity, Tone> = { Info: 'default', Warning: 'warn', Critical: 'crit' }
const MAX_ROWS = 200
const inputCls = 'rounded-lg border border-forest-900/15 bg-white px-3 py-1.5 text-sm text-forest-900 placeholder:text-moss-600/70'
const stamp = () => format(new Date(), 'yyyyMMdd-HHmmss')

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Logs &amp; Analytics</h1>
        <p className="mt-1 text-[15px] text-moss-600">Event log, history, test runs and export.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}<SourceTag /></div>
    </div>
  )
}

export default function Logs() {
  const { latest } = useTelemetry()
  const settings = useLink((s) => s.settings)
  const events = useLink((s) => s.events)
  const runs = useLink((s) => s.runs)
  const activeRun = useLink((s) => s.activeRun)
  const startRun = useLink((s) => s.startRun)
  const stopRun = useLink((s) => s.stopRun)

  const [range, setRange] = useState<number>(15)
  const [scope, setScope] = useState<string>('session')
  const [distance, setDistance] = useState('100')
  const [notes, setNotes] = useState('')
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [query, setQuery] = useState('')

  const chart = useHistory(range, 10_000)
  const whole = useHistory(1440, 30_000) // for the whole-session average

  // ----- which numbers the four summary panels show
  const picked: Run | null = scope === 'active' ? activeRun : runs.find((r) => r.id === scope) ?? null

  const sessionAvg = whole.samples.length ? mean(whole.samples.map((s) => s.rssi)) : null
  const avgRssi = picked ? (picked.samples ? picked.avgRssi : null) : sessionAvg
  const maxRange = picked ? picked.distanceM : runs.reduce((m, r) => Math.max(m, r.distanceM), 0)
  const uptimeSec = picked ? (picked.samples * picked.lockedPct) / 100 : latest?.session.uptimeSec ?? 0
  const runSeconds = picked ? (picked.endedAt ? (picked.endedAt - picked.startedAt) / 1000 : picked.samples) : 0
  const scopeLabel = picked ? `${picked.distanceM} m run, ${format(picked.startedAt, 'd MMM HH:mm')}` : 'Whole session'

  const rssiTone: Tone = avgRssi === null ? 'default' : avgRssi >= settings.lockAbove ? 'ok' : avgRssi >= settings.failBelow ? 'warn' : 'crit'

  // ----- chart data
  const rows = chart.samples
  const fmtTick = (t: number) => format(t, range <= 15 ? 'HH:mm:ss' : 'HH:mm')
  const values = rows.map((s) => s.rssi)
  const tick = { fill: TEXT, fontSize: 12 }

  // ----- event log
  const q = query.trim().toLowerCase()
  const matched = events.filter(
    (e) => (sev === 'all' || e.severity === sev) &&
      (!q || e.message.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || (e.unit ? `unit ${e.unit}`.toLowerCase().includes(q) : false)),
  )
  const shown = matched.slice(-MAX_ROWS).reverse()
  const count = (s: Severity) => events.filter((e) => e.severity === s).length

  const begin = () => startRun(Math.min(100000, Math.max(0, Number(distance) || 0)), notes.trim())

  const exportHistory = () =>
    downloadCsv(`beambi-history-${stamp()}.csv`,
      ['time', 'channel', 'link_state', 'rssi'],
      rows.map((s) => [new Date(s.ts).toISOString(), s.ch, s.state, s.rssi.toFixed(1)]))
  const exportEvents = () =>
    downloadCsv(`beambi-events-${stamp()}.csv`,
      ['time', 'severity', 'type', 'unit', 'duration_s', 'message'],
      matched.map((e: LinkEvent) => [new Date(e.ts).toISOString(), e.severity, e.type, e.unit ?? '', e.durationSec ?? '', e.message]))
    const exportRuns = () =>
    downloadCsv(`beambi-runs-${stamp()}.csv`,
      ['started', 'ended', 'distance_m', 'notes', 'seconds', 'avg_rssi', 'min_rssi', 'max_rssi', 'failovers', 'locked_pct'],
      runs.map((r) => [new Date(r.startedAt).toISOString(), r.endedAt ? new Date(r.endedAt).toISOString() : '', r.distanceM, r.notes, r.samples, r.avgRssi.toFixed(1), r.minRssi.toFixed(1), r.maxRssi.toFixed(1), r.failovers, r.lockedPct.toFixed(0)]))

  const dlBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-forest-900/15 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-mint-200 disabled:opacity-40 disabled:hover:bg-white'

  return (
    <div className="space-y-6">
      <Header>
        <div className="flex flex-wrap items-center gap-2 text-sm text-moss-600">
          <label className="flex items-center gap-2">Summary of
            <select className={inputCls} value={picked ? scope : 'session'} onChange={(e) => setScope(e.target.value)}>
              <option value="session">Whole session</option>
              {activeRun && <option value="active">Active run ({activeRun.distanceM} m)</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{format(r.startedAt, 'd MMM HH:mm')}, {r.distanceM} m</option>
              ))}
            </select>
          </label>
          <span className="font-mono text-[12px] text-moss-600">{scopeLabel}</span>
        </div>
      </Header>

      {!latest && <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">No fresh unit reports. Recorded history, events, and exports remain available.</p>}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Row 1: summary */}
        <Panel title="Average RSSI" tone={rssiTone} index={1} className="lg:col-span-4" right={<Pill>{picked ? 'Run' : 'Session'}</Pill>}>
          <Big mono tone={rssiTone}>{avgRssi === null ? '--' : avgRssi.toFixed(1)}</Big>
          <Sub>{picked ? 'Average signal strength over this run.' : 'Average signal strength over the last 24 hours of this session.'}</Sub>
          <div className="mt-3">
            <Row label="High signal display zone" value={settings.lockAbove} />
            {picked && <Row label="Lowest / highest" value={`${picked.minRssi.toFixed(0)} / ${picked.maxRssi.toFixed(0)}`} />}
          </div>
        </Panel>

        <Panel title="Entered test distance" index={2} className="lg:col-span-4" right={<Pill>{picked ? 'This run' : 'All runs'}</Pill>}>
          <Big mono>{maxRange > 0 ? maxRange.toLocaleString('en-US') : '--'}{maxRange > 0 && <span className="ml-2 text-2xl">m</span>}</Big>
          <Sub>{picked ? 'Distance entered when this run started.' : 'Longest distance entered across all test runs.'}</Sub>
          <div className="mt-3"><Row label="Test runs" value={runs.length + (activeRun ? 1 : 0)} /></div>
        </Panel>

        <Panel title="Recorded duration" index={4} className="lg:col-span-4" right={<Pill>{picked ? 'Run' : 'Session'}</Pill>}>
          <Big mono>{picked || latest ? formatDuration(uptimeSec) : '--'}</Big>
          <Sub>{picked ? 'Time with both laser indications up during recorded samples.' : 'Backend session duration; device uptime is shown on Hardware.'}</Sub>
          <div className="mt-3">
            {picked ? (
              <>
                <Row label="Run length" value={formatDuration(runSeconds)} />
                <Row label="Laser indication up" value={`${picked.lockedPct.toFixed(0)}%`} tone={picked.lockedPct >= 90 ? 'ok' : 'warn'} />
              </>
            ) : (
              <Row label="Failovers" value={latest?.session.failovers ?? '--'} />
            )}
          </div>
        </Panel>

        {/* Row 2: chart and runs */}
        <Panel title="RSSI history" index={5} className="lg:col-span-8"
          right={chart.persistence && (
            <Pill tone={chart.persistence === 'supabase' ? 'ok' : 'warn'}>
              {chart.persistence === 'supabase' ? 'Saved to Supabase' : 'Memory only'}
            </Pill>
          )}>
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Time range">
            {RANGES.map((r) => <ChartTab key={r.minutes} active={range === r.minutes} onClick={() => setRange(r.minutes)}>{r.label}</ChartTab>)}
          </div>

          {chart.error && rows.length === 0 ? (
            <div role="alert" className="rounded-xl border border-crit bg-crit/10 p-4 text-sm text-crit-ink">
              Could not load history: {chart.error}. Check that the backend is running at {BACKEND_URL}.
            </div>
          ) : rows.length < 2 ? (
            <div className="rounded-xl border border-dashed border-forest-900/20 p-8 text-center text-sm text-moss-600">
              Collecting data. The backend records one sample every 5 seconds, so a chart needs about 10 seconds.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickCount={6}
                    tickFormatter={fmtTick} tick={tick} stroke={GRID} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={44} tick={tick} stroke={GRID} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
                    labelFormatter={(l) => format(Number(l), 'd MMM HH:mm:ss')}
                    formatter={(v) => [Number(v).toFixed(1), 'RSSI']} />
                  <Line dataKey="rssi" name="RSSI" stroke="#3fae63" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  <ReferenceLine y={settings.lockAbove} stroke="#1d6b3a" strokeDasharray="6 4" strokeWidth={1.5}
                    label={{ value: `High signal ${settings.lockAbove}`, position: 'insideTopLeft', fill: '#1d6b3a', fontSize: 12, fontWeight: 600 }} />
                  <ReferenceLine y={settings.failBelow} stroke="#9b2c1f" strokeDasharray="6 4" strokeWidth={1.5}
                    label={{ value: `Low signal ${settings.failBelow}`, position: 'insideBottomLeft', fill: '#9b2c1f', fontSize: 12, fontWeight: 600 }} />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-moss-600">
                <span>Lowest <span className="font-mono font-medium text-forest-900">{Math.min(...values).toFixed(1)}</span></span>
                <span>Average <span className="font-mono font-medium text-forest-900">{mean(values).toFixed(1)}</span></span>
                <span>Highest <span className="font-mono font-medium text-forest-900">{Math.max(...values).toFixed(1)}</span></span>
                <span className="ml-auto">{rows.length} points{range >= 60 ? ', averaged' : ''}</span>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Test runs and export" index={6} className="lg:col-span-4"
          right={<Pill tone={activeRun ? 'crit' : 'default'}>{activeRun ? 'Recording' : 'Idle'}</Pill>}>
          {activeRun ? (
            <div className="rounded-xl border border-crit/40 bg-crit/5 p-3.5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl font-medium">{formatDuration(activeRun.samples)}</span>
                <span className="text-sm text-moss-600">{activeRun.distanceM} m</span>
              </div>
              <div className="mt-2">
                <Row label="Average RSSI" value={activeRun.samples ? activeRun.avgRssi.toFixed(1) : '--'} />
                <Row label="Failovers" value={activeRun.failovers} />
              </div>
              <button onClick={stopRun}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-crit-ink px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-crit">
                <Square size={14} /> Stop run
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <label className="block text-sm text-moss-600">Distance between units (m)
                <input type="number" min={0} max={100000} step={1} value={distance} onChange={(e) => setDistance(e.target.value)}
                  className={`${inputCls} mt-1 w-full font-mono`} />
              </label>
              <label className="block text-sm text-moss-600">Notes (optional)
                <input type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Clear sky, rooftop to rooftop" className={`${inputCls} mt-1 w-full`} />
              </label>
              <button onClick={begin}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-forest-800 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-700">
                <Play size={14} /> Start run
              </button>
            </div>
          )}

          <div className="mt-4 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Past runs</div>
          {runs.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-forest-900/20 p-3 text-center text-[13px] text-moss-600">
              No runs yet. Enter the distance and start one. Stop it to save the result here.
            </p>
          ) : (
            <ul className="mt-2 max-h-48 divide-y divide-forest-900/10 overflow-auto rounded-xl border border-forest-900/10">
              {runs.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setScope(r.id)} aria-pressed={scope === r.id}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-mint-50 ${scope === r.id ? 'bg-mint-100' : ''}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{r.distanceM} m</span>
                      <span className="font-mono text-[12px] text-moss-600">{format(r.startedAt, 'd MMM HH:mm')}</span>
                    </div>
                    <div className="font-mono text-[12px] text-moss-600">
                      {formatDuration(r.samples)} · RSSI {r.avgRssi.toFixed(0)} · {r.failovers} failover{r.failovers === 1 ? '' : 's'}
                    </div>
                    {r.notes && <div className="truncate text-[12px] text-moss-600">{r.notes}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className={dlBtn} onClick={exportHistory} disabled={rows.length === 0}><Download size={14} /> History</button>
            <button className={dlBtn} onClick={exportEvents} disabled={matched.length === 0}><Download size={14} /> Events</button>
            <button className={dlBtn} onClick={exportRuns} disabled={runs.length === 0}><Download size={14} /> Runs</button>
          </div>
          <p className="mt-2 text-xs text-moss-600">History uses the time range of the chart. Events use the current filters.</p>
        </Panel>

        {/* Row 3: event log */}
        <Panel title="Event log" index={7} className="lg:col-span-12"
          right={<span className="text-[13px] text-moss-600">{matched.length} of {events.length} events</span>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Severity">
              <ChartTab active={sev === 'all'} onClick={() => setSev('all')}>All {events.length}</ChartTab>
              {SEV.map((s) => <ChartTab key={s} active={sev === s} onClick={() => setSev(s)}>{s} {count(s)}</ChartTab>)}
            </div>
            <label className="relative ml-auto block w-full sm:w-72">
              <span className="sr-only">Search events</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-moss-600" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events"
                className={`${inputCls} w-full pl-9`} />
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-forest-900/20 p-6 text-center text-sm text-moss-600">
              {events.length === 0 ? 'No events yet.' : 'No events match. Clear the search or choose All.'}
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-auto rounded-xl border border-forest-900/10">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-mint-50 text-[13px] text-moss-600">
                  <tr>{['Time', 'Severity', 'Type', 'Event'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-forest-900/10">
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px] text-moss-600">{format(e.ts, 'd MMM HH:mm:ss')}</td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneChip[sevTone[e.severity]]}`}>{e.severity}</span></td>
                      <td className="px-3 py-2 font-mono text-[13px] text-moss-600">{e.type}</td>
                      <td className="px-3 py-2">
                        {e.message}
                        {e.unit && <span className="ml-2 rounded-full bg-mint-200 px-2 py-0.5 text-xs font-semibold text-forest-800">Unit {e.unit}</span>}
                        {e.durationSec !== undefined && <span className="ml-2 font-mono text-[13px] text-moss-600">{e.durationSec} s</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {matched.length > MAX_ROWS && <p className="mt-2 text-xs text-moss-600">Showing the newest {MAX_ROWS}. Export to get all {matched.length}.</p>}
        </Panel>
      </div>
    </div>
  )
}
