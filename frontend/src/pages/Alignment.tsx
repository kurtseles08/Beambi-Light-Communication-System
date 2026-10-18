import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import RssiBars from '../components/RssiBars'
import { Big, Pill, Row, SourceTag, Sub, toneFill, toneText, type Tone } from '../components/ui'
import { AIM_SIGMA, aimRadius, coach, evaluateAlignment, type Alignment as AlignmentData } from '../lib/alignment'
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

// Top-down view of the receiver. The dot is where the beam lands. Simulation only.
function AimTarget({ pan, tilt, lockR, failR }: { pan: number; tilt: number; lockR: number; failR: number }) {
  const S = 22 // pixels per step
  const x = clamp(100 + pan * S, 8, 192)
  const y = clamp(100 - tilt * S, 8, 192)
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`Beam is ${pan.toFixed(1)} steps right and ${tilt.toFixed(1)} steps up from the receiver`} className="mx-auto w-full max-w-[14rem]">
      <circle cx="100" cy="100" r="96" className="fill-crit/10 stroke-forest-900/15" />
      <circle cx="100" cy="100" r={Math.min(96, failR * S)} className="fill-warn/20" />
      <circle cx="100" cy="100" r={Math.min(96, lockR * S)} className="fill-ok/25" />
      <line x1="4" y1="100" x2="196" y2="100" className="stroke-forest-900/25" strokeDasharray="3 4" />
      <line x1="100" y1="4" x2="100" y2="196" className="stroke-forest-900/25" strokeDasharray="3 4" />
      <circle cx="100" cy="100" r="3" className="fill-forest-900/40" />
      <circle cx={x} cy={y} r="8" className="fill-forest-900 stroke-white transition-all duration-300" strokeWidth="3" />
    </svg>
  )
}

function StatPanel({ a, snr, loss, lux, hw, index, className }: { a: AlignmentData; snr: number; loss: number; lux: number; hw: boolean; index: number; className: string }) {
  return (
    <Panel title="Last 60 seconds" index={index} className={className}>
      <Row label="Best (peak)" value={a.peak.toFixed(1)} />
      <Row label="Average" value={a.avg.toFixed(1)} />
      <Row label="Lowest" value={a.min.toFixed(1)} />
      <Row label="Time at or above lock" value={`${a.aboveLockPct.toFixed(0)}%`} tone={a.aboveLockPct >= 90 ? 'ok' : a.aboveLockPct >= 50 ? 'warn' : 'crit'} />
      {!hw && (
        <>
          <Row label="Signal quality (SNR)" value={`${snr.toFixed(1)} dB`} />
          <Row label="Frame loss" value={`${loss.toFixed(1)}%`} tone={loss > 5 ? 'warn' : 'default'} />
          <Row label="Ambient light" value={`${lux.toLocaleString('en-US')} lx`} />
        </>
      )}
    </Panel>
  )
}

export default function Alignment() {
  const readings = useLink((s) => s.readings)
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const updateSettings = useLink((s) => s.updateSettings)
  const aim = useLink((s) => s.aim)
  const source = useLink((s) => s.source)

  const [beepOn, setBeepOn] = useState(false)
  const [volume, setVolume] = useState(0.5)
  const [coarse, setCoarse] = useState(false)

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

  const latest = readings[readings.length - 1]
  const zoneTone: Tone = a.zone === 'locked' ? 'ok' : a.zone === 'marginal' ? 'warn' : 'crit'
  const advice = coach(a)
  const step = coarse ? 0.5 : 0.1
  const third = latest.aim ? 'lg:col-span-4' : 'lg:col-span-6'
  const nudgeBtn = 'grid h-11 w-11 place-items-center rounded-lg border border-forest-900/15 bg-mint-50 text-forest-800 transition-colors hover:border-leaf-500 hover:bg-mint-200 active:bg-mint-200'

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Row 1: the four things asked for */}
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
            {source !== 'hardware' && <Row label="Light at receiver" value={latest.fso.rxPresent ? 'Detected' : 'None'} tone={latest.fso.rxPresent ? 'default' : 'crit'} />}
          </div>
        </Panel>

        <Panel title="Lock threshold and beep" index={3} className="lg:col-span-4">
          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-moss-600">Lock threshold</span>
              <span className="font-mono text-2xl font-medium">{settings.lockAbove}</span>
            </div>
            <input type="range" min={20} max={90} step={1} value={settings.lockAbove}
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

        {/* Row 2: the trend, tall */}
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

        {/* Row 3: help while aiming */}
        <Panel title="Aiming guide" tone={advice.tone} index={5} className={third}>
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

        {latest.aim && (
          <Panel title="Aiming practice" index={6} className={third} right={<Pill tone="warn">Simulation</Pill>}>
            <AimTarget pan={latest.aim.pan} tilt={latest.aim.tilt}
              lockR={aimRadius(settings.lockAbove, settings.clearRssi)} failR={aimRadius(settings.failBelow, settings.clearRssi)} />
            <p className="mt-2 text-center font-mono text-[13px] text-moss-600">
              Pan {signed(latest.aim.pan)} · Tilt {signed(latest.aim.tilt)} steps
            </p>

            <div className="mt-3 flex items-center justify-center gap-3">
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Nudge the aim">
                <span />
                <button className={nudgeBtn} onClick={() => aim({ dTilt: step })} aria-label="Nudge up"><ArrowUp size={18} /></button>
                <span />
                <button className={nudgeBtn} onClick={() => aim({ dPan: -step })} aria-label="Nudge left"><ArrowLeft size={18} /></button>
                <button className={nudgeBtn} onClick={() => aim({ reset: true })} aria-label="Re-center" title="Re-center"><Crosshair size={18} /></button>
                <button className={nudgeBtn} onClick={() => aim({ dPan: step })} aria-label="Nudge right"><ArrowRight size={18} /></button>
                <span />
                <button className={nudgeBtn} onClick={() => aim({ dTilt: -step })} aria-label="Nudge down"><ArrowDown size={18} /></button>
                <span />
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <button onClick={() => setCoarse(!coarse)} aria-pressed={coarse}
                  className="rounded-lg border border-forest-900/15 bg-mint-50 px-3 py-1.5 font-medium transition-colors hover:bg-mint-200">
                  Step: {coarse ? 'Coarse' : 'Fine'}
                </button>
                <button onClick={() => aim({ bump: true })}
                  className="rounded-lg border border-warn bg-warn/15 px-3 py-1.5 font-medium text-warn-ink transition-colors hover:bg-warn/25">
                  Knock the mount
                </button>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-moss-600">
              Dot = where the beam lands. Rings: green locked, amber marginal. Real hardware cannot show this offset (sigma {AIM_SIGMA} steps).
            </p>
          </Panel>
        )}

        <StatPanel a={a} snr={latest.fso.snr} loss={latest.fso.frameLoss} lux={latest.fso.ambientLux} hw={source === 'hardware'} index={7} className={third} />
      </div>
    </div>
  )
}
