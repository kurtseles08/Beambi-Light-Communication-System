import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import { RotateCcw, Target } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import { Pill, Row } from '../components/ui'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { Mode, Receiver, Settings as SettingsType } from '../types'
import { sendCommand, useDevice } from '../device/deviceStore'

const idx = (i: number) => ({ '--i': i }) as CSSProperties
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// ---------- small controls ----------

// Without onChange the slider is shown read-only
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

const MODES: { id: Mode; title: string; text: string }[] = [
  { id: 'auto', title: 'Auto', text: 'Uses the laser, and switches to LoRa when the signal drops. Switches back when it recovers.' },
  { id: 'fso', title: 'Force FSO', text: 'Stays on the laser even if the signal is weak. Use it to test the optical link alone.' },
  { id: 'rf', title: 'Force LoRa', text: 'Stays on the radio even if the laser is fine. Use it to test the fallback.' },
]

export default function Settings() {
  const s = useLink((st) => st.settings)
  const update = useLink((st) => st.updateSettings)
  const connected = useLink((st) => st.connected)
  const latest = useLink((st) => st.latest)
  const readings = useLink((st) => st.readings)
  const devices = useDevice((st) => st.devices)

  const [confirmReset, setConfirmReset] = useState(false)

  const rssi = latest ? latest.fso.rssi : null
  const rssiAvg10 = readings.length ? mean(readings.slice(-10).map((r) => r.fso.rssi)) : null

  const batteryPct = (u: 'A' | 'B') => {
    const p = devices[u]?.batPct
    return p !== undefined && p >= 0 ? `${p}%` : '--'
  }

  const patchKeys = (keys: (keyof SettingsType)[]) => {
    const p: Partial<SettingsType> = {}
    for (const k of keys) (p as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
    update(p)
  }

  // The unit itself holds the mode (0 auto, 1 laser, 2 LoRa)
  const mode: Mode = latest ? latest.mode : s.mode
  const manual = mode !== 'auto'
  const pickMode = (m: Mode) => sendCommand({ cmd: 'mode', v: m === 'auto' ? 0 : m === 'fso' ? 1 : 2 })

  return (
    <div className="space-y-6">
      <div className="rise" style={idx(0)}>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-[15px] text-moss-600">Failover mode, calibration and alerts. Changes apply right away and are saved.</p>
      </div>

      {!connected && (
        <div role="alert" className="rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
          Not connected to the backend at {BACKEND_URL}. Changes you make here will not be saved until it is running.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Failover thresholds (read-only) */}
        <Panel title="Signal zones" index={1} className="lg:col-span-6"
  right={<button className={ghostBtn} onClick={() => update({ failBelow: 50, lockAbove: 60 })}><RotateCcw size={14} /> Match unit</button>}>
  <ZoneBar rssi={rssi} fail={s.failBelow} lock={s.lockAbove} />
  <div className="mt-3">
    <Slider label="Failover below (RSSI)" value={s.failBelow} min={1} max={Math.max(1, s.lockAbove - 1)}
  hint="Colors the signal red below this. Set it to the reading where the unit really switches to LoRa."
  onChange={(v) => update({ failBelow: v })} />
<Slider label="Lock at or above (RSSI)" value={s.lockAbove} min={s.failBelow + 1} max={95}
  hint="Counts as Locked at or above this. Keep it a little above the failover level (60 works well)."
  onChange={(v) => update({ lockAbove: v })} />
  </div>
  <Row label="Band between the zones" value={`${s.lockAbove - s.failBelow} pts`} />
  <p className="mt-2 text-[13px] leading-snug text-moss-600">
    These are display zones only. The units decide when to switch, using the threshold set by Calibrate on the Hardware page.
  </p>
</Panel>

        {/* Failover mode */}
        <Panel title="Failover mode" tone={manual ? 'warn' : 'ok'} index={2} className="lg:col-span-6"
          right={<Pill tone={manual ? 'warn' : 'ok'}>{manual ? 'Manual' : 'Automatic'}</Pill>}>
          <div role="radiogroup" aria-label="Failover mode" className="space-y-2.5">
            {MODES.map((m) => {
              const on = mode === m.id
              return (
                <button key={m.id} role="radio" aria-checked={on} onClick={() => pickMode(m.id)}
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
          right={<button className={ghostBtn} onClick={() => patchKeys(['clearRssi', 'receiver'])}><RotateCcw size={14} /> Defaults</button>}>
          <Slider label="Clear-air RSSI" value={s.clearRssi} min={40} max={100}
            hint="The unit switches to LoRa when the signal falls below 50 on this scale, so keep this at 50 unless you changed the threshold."
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

        {/* Battery alerts */}
        <Panel title="Battery alerts" index={4} className="lg:col-span-6"
          right={<button className={ghostBtn} onClick={() => patchKeys(['lowBatteryPct', 'critBatteryPct'])}><RotateCcw size={14} /> Defaults</button>}>
          <Slider label="Low battery warning" value={s.lowBatteryPct} min={Math.max(5, s.critBatteryPct + 1)} max={60} unit="%"
            hint="A Warning alert is raised when a unit falls to this level."
            onChange={(v) => update({ lowBatteryPct: v })} />
          <Slider label="Critical battery" value={s.critBatteryPct} min={2} max={Math.min(40, s.lowBatteryPct - 1)} unit="%"
            hint="The alert becomes Critical at this level."
            onChange={(v) => update({ critBatteryPct: v })} />
          <Row label="Unit A now" value={batteryPct('A')} />
          <Row label="Unit B now" value={batteryPct('B')} />
        </Panel>

        {/* Reset */}
        <Panel title="Saving and reset" index={5} className="lg:col-span-12">
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