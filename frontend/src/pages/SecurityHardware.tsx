import type { CSSProperties } from 'react'
import { format } from 'date-fns'
import { useLink, BACKEND_URL } from '../store/link'
import { useDevice } from '../device/deviceStore'
import Panel from '../components/Panel'
import { Big, Pill, Row, SourceTag, Sub, type Tone } from '../components/ui'
import { formatDuration } from '../lib/linkStatus'
import { NOISE_REF_DBM } from '../lib/security'

const idx = (i: number) => ({ '--i': i }) as CSSProperties
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}`

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="mt-1 text-[15px] text-moss-600">What the real units can report. Encryption and tamper detection are not built yet.</p>
      </div>
      <SourceTag />
    </div>
  )
}

export default function SecurityHardware() {
  const latest = useLink((s) => s.latest)
  const events = useLink((s) => s.events)
  const connected = useLink((s) => s.connected)
  const lora = useDevice((s) => s.device?.lora)

  if (!latest) {
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

  const tamperA = latest.units.A.tamper
  const tamperB = latest.units.B.tamper
  const heard = !!lora && lora.ok === 1 && lora.peer !== '-' && lora.ageS >= 0 && lora.ageS <= 10
  const floor = heard && lora ? lora.rssi - lora.snr : null
  const rise = floor === null ? null : floor - NOISE_REF_DBM
  const noiseTone: Tone = rise === null ? 'default' : rise >= 15 ? 'crit' : rise >= 8 ? 'warn' : 'ok'
  const alerts = events.filter((e) => e.severity !== 'Info').slice(-8).reverse()

  return (
    <div className="space-y-6">
      <Header />
      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Encryption status" tone="warn" index={1} className="lg:col-span-4" right={<Pill tone="warn">Not built yet</Pill>}>
          <Big stencil size="md" tone="warn">Not encrypted</Big>
          <Sub>The firmware sends laser and LoRa data without encryption or authentication. Do not rely on this link for private data until encryption is added.</Sub>
        </Panel>

        <Panel title="Tamper alerts" tone={tamperA || tamperB ? 'crit' : 'default'} index={2} className="lg:col-span-4">
          <Row label="Unit A enclosure" value={tamperA ? 'Opened' : 'Not monitored'} tone={tamperA ? 'crit' : 'default'} />
          <Row label="Unit B enclosure" value={tamperB ? 'Opened' : 'Not monitored'} tone={tamperB ? 'crit' : 'default'} />
          <Sub>No tamper switch is wired yet. Add a micro switch on a free pin to enable this.</Sub>
        </Panel>

        <Panel title="Radio interference" tone={noiseTone} index={3} className="lg:col-span-4">
          <Big mono tone={noiseTone}>{floor === null ? '--' : floor.toFixed(0)}<span className="ml-2 text-2xl">dBm</span></Big>
          <Sub>
            {floor === null
              ? 'Needs a LoRa packet from the other unit. Not measured now.'
              : `Noise floor of the last packet, ${signed(rise ?? 0)} dB against a quiet channel (${NOISE_REF_DBM} dBm). One reading is a warning sign only.`}
          </Sub>
        </Panel>

        <Panel title="Recent warnings and alerts" index={4} className="lg:col-span-12">
          {alerts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-forest-900/20 p-4 text-center text-sm text-moss-600">No warnings or alerts yet.</p>
          ) : (
            <ul className="divide-y divide-forest-900/10 rounded-xl border border-forest-900/10">
              {alerts.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <span className="shrink-0 font-mono text-[13px] text-moss-600">{format(e.ts, 'HH:mm:ss')}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${e.severity === 'Critical' ? 'bg-crit/15 text-crit-ink' : 'bg-warn/20 text-warn-ink'}`}>{e.severity}</span>
                  <span className="flex-1">{e.message}</span>
                  <span className="shrink-0 font-mono text-[13px] text-moss-600">{formatDuration((latest.ts - e.ts) / 1000)} ago</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}