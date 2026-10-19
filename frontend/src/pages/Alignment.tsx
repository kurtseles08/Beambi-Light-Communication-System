import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import RssiBars from '../components/RssiBars'
import { Big, Pill, Row, SourceTag, Sub, toneFill, toneText, type Tone } from '../components/ui'
import { coach, evaluateAlignment, type Alignment as AlignmentData } from '../lib/alignment'
import { beepHz, useBeep } from '../hooks/useBeep'

const idx = (i: number) => ({ '--i': i }) as CSSProperties
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(digits)}`

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Alignment</h1>
        <p className="mt-1 text-[15px] text-moss-600">Aim the laser and watch the signal. Higher is better.</p>
      </div>
      <SourceTag />
    </div>
  )
}

// Horizontal bar with colored zones, the lock and failover marks, and a peak-hold marker
function RssiBar({ rssi, peak, fail, lock, tone }: { rssi: number; peak: number; fail: number; lock: number; tone: Tone }) {
  return (
    <div className="mt-5">
      <div className="relative h-11 overflow-hidden rounded-lg border border-forest-900/15 bg-mint-50">
        <div className="absolute inset-y-0 left-0 bg-crit/15" style={{ width: `${fail}%` }} />
        <div className="absolute inset-y-0 bg-warn/15" style={{ left: `${fail}%`, width: `${Math.max(0, lock - fail)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-ok/15" style={{ left: `${lock}%` }} />
        <div className={`absolute inset-y-0 left-0 rounded-r-md transition-[width] duration-300 ${toneFill[tone]}`} style={{ width: `${clamp(rssi, 0, 100)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-crit-ink" style={{ left: `${fail}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ok-ink" style={{ left: `${lock}%` }} />
        <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-forest-950 ring-2 ring-white transition-[left] duration-300" style={{ left: `${clamp(peak, 0, 100)}%` }} />
      </div>
      <div className="relative mt-1 h-4 font-mono text-[11px] text-moss-600">
        {[0, fail, lock, 100].map((v, i) => (
          <span key={`${v}-${i}`} className="absolute -translate-x-1/2" style={{ left: `${v}%` }}>{v}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-moss-600">
        <span className="flex items-center gap-1.5"><span className="h-3 w-1 bg-forest-950" />Peak {peak.toFixed(1)} (60 s)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ok-ink" />Lock {lock}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-crit-ink" />Failover {fail}</span>
      </div>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-leaf-600' : 'bg-forest-900/20'}`}>
      <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function StatPanel({ a, index, className }: { a: AlignmentData; index: number; className: string }) {
  return (
    <Panel title="Last 60 seconds" index={index} className={className}>
      <Row label="Best (peak)" value={a.peak.toFixed(1)} />
      <Row label="Average" value={a.avg.toFixed(1)} />
      <Row label="Lowest" value={a.min.toFixed(1)} />
      <Row label="Time at or above lock" value={`${a.aboveLockPct.toFixed(0)}%`} tone={a.aboveLockPct >= 90 ? 'ok' : a.aboveLockPct >= 50 ? 'warn' : 'crit'} />
    </Panel>
  )
}

export default function Alignment() {
  const readings = useLink((s) => s.readings)
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const updateSettings = useLink((s) => s.updateSettings)

  const [beepOn, setBeepOn] = useState(false)
  const [volume, setVolume] = useState(0.5)

  const a = useMemo(() => evaluateAlignment(readings, settings), [readings, settings])
  useBeep(beepOn, a?.rssi ?? null, volume)

  if (!a) {
    return (
      <div className="space-y-6">
        <Header />
        <Panel title="Waiting for data" index={1}>
          <p className="text-[15px]">
            {connected
              ? 'Connected. Waiting for the first reading...'
              : `Cannot reach the backend at ${BACKEND_URL}. Start everything with npm run dev from the project root.`}
          </p>
        </Panel>
      </div>
    )
  }

  const zoneTone: Tone = a.zone === 'locked' ? 'ok' : a.zone === 'marginal' ? 'warn' : 'crit'
  const advice = coach(a)

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Live RSSI" tone={zoneTone} index={1} className="lg:col-span-4"
          right={<Pill tone={zoneTone}>{a.zone === 'locked' ? 'Above lock' : a.zone === 'marginal' ? 'Marginal' : 'Below failover'}</Pill>}>
          <Big mono tone={zoneTone}>{a.rssi.toFixed(1)}</Big>
          <Sub>Received signal strength, 0 to 100</Sub>
          <RssiBar rssi={a.rssi} peak={a.peak} fail={settings.failBelow} lock={settings.lockAbove} tone={zoneTone} />
        </Panel>

        <Panel title="Alignment status" tone={zoneTone} index={2} className="lg:col-span-4">
          <Big stencil size="md" tone={zoneTone}>{a.aligned ? 'Aligned' : 'Not aligned'}</Big>
          <Sub>
            {a.aligned
              ? `${a.margin.toFixed(1)} points above the lock threshold`
              : a.zone === 'marginal'
                ? `${(-a.margin).toFixed(1)} points below the lock threshold`
                : 'Below the failover threshold. The link would switch to radio.'}
          </Sub>
          {a.drifting && (
            <div role="alert" className="mt-4 rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
              <div className="font-semibold">Signal drift</div>
              <div>Falling {Math.abs(a.slopePer10s).toFixed(1)} points every 10 s. The mount may be slipping from wind or vibration.</div>
            </div>
          )}
          <div className="mt-4">
            <Row label="Margin to lock" value={`${signed(a.margin)} pts`} tone={a.margin >= 0 ? 'ok' : a.zone === 'marginal' ? 'warn' : 'crit'} />
            <Row label="Change (per 10 s)" value={`${signed(a.slopePer10s)} pts`} tone={a.drifting ? 'warn' : 'default'} />
            <Row label="Stability" value={`${a.stability} (\u03c3 ${a.sigma.toFixed(1)})`} tone={a.stability === 'Stable' ? 'default' : a.stability === 'Fluctuating' ? 'warn' : 'crit'} />
          </div>
        </Panel>

        <Panel title="Lock threshold and beep" index={3} className="lg:col-span-4">
          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-moss-600">Lock threshold</span>
              <span className="font-mono text-2xl font-medium">{settings.lockAbove}</span>
            </div>
            <input type="range" min={settings.failBelow + 1} max={95} step={1} value={settings.lockAbove}
  onChange={(e) => updateSettings({ lockAbove: Number(e.target.value) })}
  aria-label="Lock threshold" className="mt-2 w-full accent-leaf-600" />
          </label>
          <div className="mt-2">
            <Row label="Failover threshold" value={settings.failBelow} />
            <Row label="Hysteresis band" value={`${settings.lockAbove - settings.failBelow} pts`} />
          </div>

          <div className="mt-4 border-t border-forest-900/10 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Audio beep</div>
                <div className="text-[13px] text-moss-600">The pitch rises as the signal gets stronger.</div>
              </div>
              <Switch on={beepOn} onChange={setBeepOn} label="Audio beep" />
            </div>
            <label className="mt-3 block">
              <div className="flex items-baseline justify-between text-sm text-moss-600">
                <span>Volume</span>
                <span className="font-mono">{beepOn ? `${Math.round(beepHz(a.rssi))} Hz` : 'Off'}</span>
              </div>
              <input type="range" min={0.1} max={1} step={0.05} value={volume} disabled={!beepOn}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Beep volume" className="mt-1 w-full accent-leaf-600 disabled:opacity-40" />
            </label>
          </div>
        </Panel>

        <Panel title="RSSI trend, last 60 seconds" index={4} className="lg:col-span-12"
          right={
            <div className="hidden items-center gap-3 text-xs text-moss-600 sm:flex">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-leaf-500" />Locked</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-warn" />Marginal</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-crit" />Below failover</span>
            </div>
          }>
          <RssiBars readings={readings} fail={settings.failBelow} lock={settings.lockAbove} height={400} />
        </Panel>

        <Panel title="Aiming guide" tone={advice.tone} index={5} className="lg:col-span-6">
          <div className={`font-display text-3xl font-bold leading-tight ${toneText[advice.tone]}`}>{advice.title}</div>
          <p className="mt-2 text-[15px] leading-snug">{advice.text}</p>
          <div className="mt-4">
            <Row label="Signal is" value={a.trend === 'rising' ? 'Rising' : a.trend === 'falling' ? 'Falling' : 'Steady'}
              tone={a.trend === 'rising' ? 'ok' : a.trend === 'falling' ? 'warn' : 'default'} />
            <Row label="Gap to best (60 s)" value={`${(a.peak - a.rssi).toFixed(1)} pts`} />
          </div>
          <div className="mt-4 border-t border-forest-900/10 pt-4">
            <div className="mb-2 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">How to align</div>
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-snug text-moss-600">
              <li>Sweep slowly until the bar starts to move.</li>
              <li>Move in big steps toward the direction that raises it.</li>
              <li>Near the top, switch to small steps.</li>
              <li>Stop at the highest reading, then tighten the mount.</li>
            </ol>
          </div>
        </Panel>

        <StatPanel a={a} index={6} className="lg:col-span-6" />
      </div>
    </div>
  )
}