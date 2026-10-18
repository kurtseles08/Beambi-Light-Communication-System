import { useEffect, useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { format } from 'date-fns'
import { RotateCcw, Target } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import { Big, Pill, Row, SourceTag, Sub, toneSolid, type Tone } from '../components/ui'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { Inject, Mode, Receiver, Settings as SettingsType } from '../types'
import { sendCommand } from '../device/deviceStore'




const idx = (i: number) => ({ '--i': i }) as CSSProperties
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// ---------- small controls ----------

function Slider({ label, hint, value, min, max, step = 1, unit = '', onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step?: number; unit?: string; onChange?: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="border-b border-forest-900/10 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <span className="font-mono text-lg font-medium tabular-nums">{value.toLocaleString('en-US')}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={Math.max(min, max)} step={step} value={value}
        onChange={onChange ? (e) => onChange(Number(e.target.value)) : undefined} disabled={!onChange}
        className="mt-1.5 w-full accent-leaf-600" />
      <p className="mt-1 text-[13px] leading-snug text-moss-600">{hint}</p>
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

const ghostBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-forest-900/15 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-mint-200 disabled:opacity-40 disabled:hover:bg-white'

// Where the signal sits against the two thresholds, with a live marker
function ZoneBar({ rssi, fail, lock }: { rssi: number | null; fail: number; lock: number }) {
  return (
    <div>
      <div className="relative h-9 overflow-hidden rounded-lg border border-forest-900/15 bg-mint-50"
        role="img" aria-label={`Failover below ${fail}, locked at ${lock} and above`}>
        <div className="absolute inset-y-0 left-0 bg-crit/25" style={{ width: `${fail}%` }} />
        <div className="absolute inset-y-0 bg-warn/25" style={{ left: `${fail}%`, width: `${Math.max(0, lock - fail)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-ok/25" style={{ left: `${lock}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-crit-ink" style={{ left: `${fail}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-ok-ink" style={{ left: `${lock}%` }} />
        {rssi !== null && (
          <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-forest-950 ring-2 ring-white transition-[left] duration-300"
            style={{ left: `${clamp(rssi, 0, 100)}%` }} />
        )}
      </div>
      <div className="relative mt-1 h-4 font-mono text-[11px] text-moss-600">
        {[0, fail, lock, 100].map((v, i) => (
          <span key={`${v}-${i}`} className="absolute -translate-x-1/2" style={{ left: `${v}%` }}>{v}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-moss-600">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-crit/40" />Switches to LoRa</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-warn/40" />Hysteresis band: stays as is</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-ok/40" />Locked</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-1 bg-forest-950" />Live signal</span>
      </div>
    </div>
  )
}

// ---------- failover mode ----------

const MODES: { id: Mode; title: string; text: string }[] = [
  { id: 'auto', title: 'Auto', text: 'Uses the laser, and switches to LoRa when the signal drops. Switches back when it recovers.' },
  { id: 'fso', title: 'Force FSO', text: 'Stays on the laser even if the signal is weak. Use it to test the optical link alone.' },
  { id: 'rf', title: 'Force LoRa', text: 'Stays on the radio even if the laser is fine. Use it to test the fallback.' },
]

// ---------- demo controls ----------

const GROUPS: { title: string; items: { kind: Inject; label: string; hint: string }[] }[] = [
  {
    title: 'Weather and light',
    items: [
      { kind: 'fog', label: 'Simulate fog', hint: 'Signal fades slowly until cleared' },
      { kind: 'dust', label: 'Dust or haze', hint: 'Milder, slow fade in dry air' },
      { kind: 'glare', label: 'Strong sunlight', hint: 'Ambient light disturbs the receiver' },
    ],
  },
  {
    title: 'Beam',
    items: [
      { kind: 'obstruction', label: 'Block the beam', hint: 'Sudden signal loss for 12 s' },
      { kind: 'drift', label: 'Beam drift', hint: 'Mount creeps off target. Re-aim on Alignment' },
    ],
  },
  {
    title: 'Link and units',
    items: [
      { kind: 'lossburst', label: 'Inject packet loss', hint: '15 s of lost frames' },
      { kind: 'tamper', label: 'Tamper alert', hint: 'A unit enclosure is opened' },
      { kind: 'lowbattery', label: 'Low battery', hint: 'Unit A drops to the warning level' },
    ],
  },
  {
    title: 'Voice',
    items: [
      { kind: 'message', label: 'Send a message', hint: 'A voice message from Unit A or B' },
      { kind: 'stutter', label: 'Stuttered voice', hint: 'Broken audio that must be rejected' },
      { kind: 'noise', label: 'Ambient noise', hint: 'Background sound that must be ignored' },
    ],
  },
]

const sevDot = { Info: 'bg-leaf-500', Warning: 'bg-warn', Critical: 'bg-crit' } as const

// ---------- page ----------

export default function Settings() {
  const s = useLink((st) => st.settings)
  const update = useLink((st) => st.updateSettings)
  const inject = useLink((st) => st.inject)
  const connected = useLink((st) => st.connected)
  const source = useLink((st) => st.source)
  const scenario = useLink((st) => st.scenario)
  const latest = useLink((st) => st.latest)
  const readings = useLink((st) => st.readings)
  const events = useLink((st) => st.events)

  const [sent, setSent] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (!sent) return
    const id = setTimeout(() => setSent(null), 1800)
    return () => clearTimeout(id)
  }, [sent])

  const sim = source === 'simulator'
  const hw = source === 'hardware'
  const rssi = latest ? latest.fso.rssi : null
  const rssiAvg10 = readings.length ? mean(readings.slice(-10).map((r) => r.fso.rssi)) : null

  const patchKeys = (keys: (keyof SettingsType)[]) => {
    const p: Partial<SettingsType> = {}
    for (const k of keys) (p as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
    update(p)
  }

  const run = (kind: Inject, label: string) => {
    inject(kind)
    setSent(label)
  }

   // On real hardware the unit itself holds the mode (0 auto, 1 laser, 2 LoRa)
  const mode: Mode = hw && latest ? latest.mode : s.mode
  const manual = mode !== 'auto'
  const pickMode = (m: Mode) => (hw ? sendCommand({ cmd: 'mode', v: m === 'auto' ? 0 : m === 'fso' ? 1 : 2 }) : update({ mode: m }))
  const recent = events.slice(-4).reverse()

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="mt-1 text-[15px] text-moss-600">Thresholds, failover mode, calibration and demo mode. Changes apply right away and are saved.</p>
        </div>
        <SourceTag />
      </div>

      {!connected && (
        <div role="alert" className="rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
          Not connected to the backend at {BACKEND_URL}. Changes you make here will not be saved until it is running.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Failover thresholds */}
        <Panel title="Failover thresholds" index={1} className="lg:col-span-6"
          right={<button className={ghostBtn} onClick={() => patchKeys(['failBelow', 'lockAbove', 'failDelaySec', 'recoverHoldSec', 'maxFrameLoss'])}><RotateCcw size={14} /> Defaults</button>}>
          
          
          
          <ZoneBar rssi={rssi} fail={s.failBelow} lock={s.lockAbove} />
          <div className="mt-3">
            <ZoneBar rssi={rssi} fail={s.failBelow} lock={s.lockAbove} />
            </div>
<div className="mt-3">
  <Slider label="Failover below (RSSI)" value={s.failBelow} min={5} max={Math.min(80, s.lockAbove - 5)}
    hint="If the signal stays under this, the link switches to LoRa."
    onChange={!hw ? (v) => update({ failBelow: v }) : undefined} />
  <Slider label="Lock at or above (RSSI)" value={s.lockAbove} min={Math.max(10, s.failBelow + 5)} max={95}
    hint="The link counts as Locked above this, and the laser is trusted again."
    onChange={!hw ? (v) => update({ lockAbove: v }) : undefined} />
  <Slider label="Failover delay" value={s.failDelaySec} min={1} max={30} unit=" s"
    hint="How long the signal must stay low before switching. Avoids switching on a brief dip."
    onChange={!hw ? (v) => update({ failDelaySec: v }) : undefined} />
  <Slider label="Recovery hold" value={s.recoverHoldSec} min={1} max={60} unit=" s"
    hint="How long the signal must stay good before going back to the laser."
    onChange={!hw ? (v) => update({ recoverHoldSec: v }) : undefined} />
  <Slider label="Packet-loss limit" value={s.maxFrameLoss} min={5} max={90} unit="%"
    hint="Frame loss above this also triggers a failover, even if RSSI looks fine."
    onChange={!hw ? (v) => update({ maxFrameLoss: v }) : undefined} />
          </div>
          <Row label="Hysteresis band" value={`${s.lockAbove - s.failBelow} pts`} />
          <p className="mt-2 text-[13px] leading-snug text-moss-600">
            The gap between the two levels stops the link from flipping back and forth when the signal sits near one of them. The two levels stay at least 5 points apart.
          </p>
        </Panel>

        {/* Failover mode */}
        <Panel title="Failover mode" tone={manual ? 'warn' : 'ok'} index={2} className="lg:col-span-6"
          right={<Pill tone={manual ? 'warn' : 'ok'}>{manual ? 'Manual' : 'Automatic'}</Pill>}>
          <div role="radiogroup" aria-label="Failover mode" className="space-y-2.5">
            {MODES.map((m) => {
              const on = mode === m.id
              return (
                <button key={m.id} role="radio" aria-checked={on}  onClick={() => pickMode(m.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                    on ? 'border-forest-800 bg-mint-100' : 'border-forest-900/15 bg-white hover:bg-mint-50'}`}>
                  <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-forest-800' : 'border-forest-900/30'}`}>
                    {on && <span className="h-2 w-2 rounded-full bg-forest-800" />}
                  </span>
                  <span>
                    <span className="block font-display text-lg font-semibold">{m.title}</span>
                    <span className="block text-[13px] leading-snug text-moss-600">{m.text}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {manual && (
            <div role="status" className="mt-3 rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
              Automatic failover is off. The link will not switch channels by itself. Set the mode back to Auto after testing.
            </div>
          )}
          <div className="mt-3">
            <Row label="Active channel" value={latest ? latest.activeChannel : '--'} tone={latest?.activeChannel === 'RF' ? 'warn' : 'default'} />
            <Row label="Link state" value={latest ? latest.linkState : '--'} />
            <Row label="Failovers this session" value={latest ? latest.session.failovers : '--'} />
          </div>
        </Panel>

        {/* Calibration */}
        <Panel title="Calibration" index={3} className="lg:col-span-6"
          right={<button className={ghostBtn} onClick={() => patchKeys(['clearRssi', 'ambientWarnLux', 'ambientCritLux', 'receiver'])}><RotateCcw size={14} /> Defaults</button>}>
          <Slider label="Clear-air RSSI" value={s.clearRssi} min={40} max={100}
            hint="The signal you get with the beam aligned on a clear day. Used to work out how much signal is lost."
            onChange={(v) => update({ clearRssi: v })} />
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl bg-mint-50 p-3">
            <div className="text-sm">
              <div className="text-moss-600">Signal now (10 s average)</div>
              <div className="font-mono text-lg font-medium">{rssiAvg10 === null ? '--' : rssiAvg10.toFixed(1)}</div>
            </div>
            <button className={`${ghostBtn} ml-auto`} disabled={rssiAvg10 === null}
              onClick={() => rssiAvg10 !== null && update({ clearRssi: clamp(Math.round(rssiAvg10), 40, 100) })}>
              <Target size={14} /> Use current signal
            </button>
            <p className="w-full text-[13px] leading-snug text-moss-600">Only do this in clear weather with the mount aligned. Otherwise the baseline will be too low.</p>
          </div>
          <Slider label="Ambient light warning" value={s.ambientWarnLux} min={1000} max={Math.min(100000, s.ambientCritLux - 1000)} step={1000} unit=" lx"
            hint="An alert is raised when the light reaches this level."
            onChange={(v) => update({ ambientWarnLux: v })} />
          <Slider label="Ambient light critical" value={s.ambientCritLux} min={Math.max(2000, s.ambientWarnLux + 1000)} max={120000} step={1000} unit=" lx"
            hint="The alert becomes Critical at this level."
            onChange={(v) => update({ ambientCritLux: v })} />
          <Row label="Light right now" value={latest ? `${latest.fso.ambientLux.toLocaleString('en-US')} lx` : '--'} />
          <div className="mt-3 border-t border-forest-900/10 pt-3">
            <div className="mb-2 text-sm font-medium">Receiver</div>
            <div role="radiogroup" aria-label="Receiver type" className="grid grid-cols-2 gap-2">
              {([['solar-panel', 'Solar panel'], ['photodiode', 'Photodiode']] as [Receiver, string][]).map(([id, label]) => (
                <button key={id} role="radio" aria-checked={s.receiver === id} onClick={() => update({ receiver: id })}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    s.receiver === id ? 'border-forest-800 bg-forest-800 text-white' : 'border-forest-900/15 bg-white text-forest-800 hover:bg-mint-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-moss-600">A solar panel collects far more stray light than a small photodiode, so sunlight disturbs it more.</p>
          </div>
        </Panel>

        {/* Test and demo mode */}
        <Panel title="Test and demo mode" tone={scenario === 'clear' ? 'default' : 'warn'} index={4} className="lg:col-span-6"
          right={<Pill tone={scenario === 'clear' ? 'ok' : 'warn'}>Active: {scenario}</Pill>}>
          {!sim && (
            <div role="status" className="mb-3 rounded-xl border border-forest-900/15 bg-mint-50 p-3 text-sm text-moss-600">
              These controls only work with the simulator. They are switched off when real hardware is connected.
            </div>
          )}
          <div className="space-y-4">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-1.5 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">{g.title}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.items.map((it) => {
                    const active = scenario === it.kind
                    return (
                      <button key={it.kind} disabled={!sim} onClick={() => run(it.kind, it.label)} aria-pressed={active}
                        className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                          active ? `${toneSolid.warn} border-warn` : 'border-forest-900/15 bg-mint-50 hover:border-leaf-500 hover:bg-mint-200'}`}>
                        <div className="font-display text-base font-semibold leading-tight">{it.label}</div>
                        <div className={`text-[12.5px] leading-snug ${active ? 'text-forest-950/80' : 'text-moss-600'}`}>{it.hint}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button disabled={!sim} onClick={() => run('clear', 'Back to normal')}
              className="inline-flex items-center gap-2 rounded-lg bg-forest-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest-700 disabled:opacity-50">
              Clear all and go back to normal
            </button>
            {sent && <span role="status" className="text-sm text-ok-ink">Sent: {sent}</span>}
          </div>
        
          {sim && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-forest-900/10 pt-4">
            <div>
              <div className="font-medium">Random scenarios</div>
              <div className="text-[13px] text-moss-600">The simulator occasionally injects fog, glare, a blocked beam or a tamper alert by itself. Turn off for a predictable demo.</div>
            </div>
            <Switch on={s.autoScenarios} onChange={(v) => update({ autoScenarios: v })} label="Random scenarios" />
          </div>
          )}

          <div className="mt-4 rounded-xl border border-forest-900/10 bg-mint-50 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">What the link is doing</span>
              {latest && <Pill tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'}>{latest.activeChannel} · {latest.linkState}</Pill>}
            </div>
            {latest && <Big mono size="md" tone={latest.fso.rssi >= s.lockAbove ? 'ok' : latest.fso.rssi >= s.failBelow ? 'warn' : 'crit' as Tone}>RSSI {latest.fso.rssi.toFixed(0)}</Big>}
            <Sub>Watch the effect here, or open Home and Environment.</Sub>
            <ul className="mt-2 space-y-1 text-[13px]">
              {recent.length === 0 && <li className="text-moss-600">No events yet.</li>}
              {recent.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sevDot[e.severity]}`} />
                  <span className="shrink-0 font-mono text-moss-600">{format(e.ts, 'HH:mm:ss')}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* Battery alerts */}
        <Panel title="Battery alerts" index={5} className="lg:col-span-6"
          right={<button className={ghostBtn} onClick={() => patchKeys(['lowBatteryPct', 'critBatteryPct'])}><RotateCcw size={14} /> Defaults</button>}>
          <Slider label="Low battery warning" value={s.lowBatteryPct} min={Math.max(5, s.critBatteryPct + 1)} max={60} unit="%"
            hint="A Warning alert is raised when a unit falls to this level."
            onChange={(v) => update({ lowBatteryPct: v })} />
          <Slider label="Critical battery" value={s.critBatteryPct} min={2} max={Math.min(40, s.lowBatteryPct - 1)} unit="%"
            hint="The alert becomes Critical at this level."
            onChange={(v) => update({ critBatteryPct: v })} />
          <Row label="Unit A now" value={latest ? `${latest.units.A.battery.toFixed(0)}%` : '--'} />
          <Row label="Unit B now" value={latest ? `${latest.units.B.battery.toFixed(0)}%` : '--'} />
        </Panel>

        {/* Reset */}
        <Panel title="Saving and reset" index={6} className="lg:col-span-6">
          <p className="text-[15px] leading-snug">Every change is saved by the backend and kept after a restart. Everyone who opens the dashboard sees the same settings.</p>
          <div className="mt-4">
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-crit-ink">Reset every setting to its default?</span>
                <button className="rounded-lg bg-crit-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-crit"
                  onClick={() => { update({ ...DEFAULT_SETTINGS }); setConfirmReset(false) }}>Yes, reset all</button>
                <button className={ghostBtn} onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className={ghostBtn} onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset all settings</button>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
