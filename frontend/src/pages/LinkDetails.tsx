import { useTelemetry, useFreshDevices } from '../hooks/useTelemetry'
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import Gauge from '../components/Gauge'
import { Big, Pill, Row, SourceTag, Sub, type Tone } from '../components/ui'

const idx = (i: number) => ({ '--i': i }) as CSSProperties

const rfTone = (dbm: number): Tone => (dbm > -100 ? 'ok' : dbm > -110 ? 'warn' : 'crit')

const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'

const TABS = [
  { id: 'fso', label: 'FSO' },
  { id: 'rf', label: 'RF (LoRa)' },
] as const
type TabId = (typeof TABS)[number]['id']

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Link Details</h1>
        <p className="mt-1 text-[15px] text-moss-600">FSO and LoRa metrics from the units.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <SourceTag />
      </div>
    </div>
  )
}

function Tabs({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Link detail sections" className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
            tab === t.id
              ? 'border-forest-800 bg-forest-800 text-white'
              : 'border-forest-900/15 bg-white text-forest-800 hover:bg-mint-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------- FSO tab ----------

function SignalTrend({ data }: { data: { t: number; rssi: number }[] }) {
  const tick = { fill: TEXT, fontSize: 12 }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 0]} ticks={[-60, -45, -30, -15, 0]}
          tickFormatter={(v: number) => (v === 0 ? 'now' : `${v}s`)} tick={tick} stroke={GRID} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={38} tick={tick} stroke={GRID} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
          labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
          formatter={(value) => [Number(value).toFixed(1), 'RSSI']}
        />
        <Line dataKey="rssi" stroke="#3fae63" strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function FsoTab() {
  const { readings } = useTelemetry()
  const settings = useLink((s) => s.settings)
  const latest = readings[readings.length - 1]
  const f = latest.fso

  const zone = f.rssi >= settings.lockAbove ? 'locked' : f.rssi >= settings.failBelow ? 'marginal' : 'fail'
  const zoneTone: Tone = zone === 'locked' ? 'ok' : zone === 'marginal' ? 'warn' : 'crit'

  const recent = readings.slice(-60)
  const data = recent.map((r) => ({ t: (r.ts - latest.ts) / 1000, rssi: r.fso.rssi }))

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Panel title="Optical signal" tone={zoneTone} index={1} className="lg:col-span-6"
        right={<Pill tone={zoneTone}>{zone === 'locked' ? 'High signal' : zone === 'marginal' ? 'Marginal' : 'Low signal'}</Pill>}>
        <Gauge value={f.rssi} fail={settings.failBelow} lock={settings.lockAbove} />
        <div className="mt-3">
          <Row label="RSSI" value={f.rssi.toFixed(1)} tone={zoneTone} />
        </div>
      </Panel>

      <Panel title="Hardware status" index={2} className="lg:col-span-6"
        right={<Pill tone={f.laserOk ? 'ok' : 'warn'}>{f.laserOk ? 'Link up' : 'Link down'}</Pill>}>
        <Row label="Laser link" value={f.laserOk ? 'Up' : 'Down'} tone={f.laserOk ? 'ok' : 'warn'} />
        <Row label="Selected path" value={latest.activeChannel === 'FSO' ? 'Laser' : 'LoRa telemetry'}
          tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'} />
      </Panel>

      <Panel title="RSSI, last 60 seconds" index={3} className="lg:col-span-12">
        <SignalTrend data={data} />
      </Panel>
    </div>
  )
}

// ---------- RF tab: what the unit's own LoRa module reports about its peer ----------

function RfTab() {
  const { device: d, deviceConnected: linked } = useFreshDevices()
  const { latest } = useTelemetry()
  if (!latest) return null
  if (!linked || !d) {
    return (
      <Panel title="LoRa radio" tone="crit" index={1}>
        <p className="text-[15px]">No reports from the unit shown on the Hardware page.</p>
      </Panel>
    )
  }
  const heard = d.lora.peer !== '-' && d.lora.ageS >= 0
  const stale = !heard || d.lora.ageS > 10
  const tone: Tone = !d.lora.ok ? 'crit' : stale ? 'warn' : 'ok'
  const active = latest.activeChannel === 'RF'
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Panel title={`LoRa radio (Unit ${d.unit})`} tone={tone} index={1} className="lg:col-span-6"
        right={<Pill tone={tone}>{!d.lora.ok ? 'Module failed' : stale ? 'No peer' : 'Peer online'}</Pill>}>
        <Big mono tone={heard ? rfTone(d.lora.rssi) : 'default'}>{heard ? d.lora.rssi : '--'}<span className="ml-2 text-2xl">dBm</span></Big>
        <Sub>Signal of the last packet from the peer. Closer to 0 is stronger.</Sub>
        <div className="mt-4">
          <Row label="Peer" value={heard ? `Unit ${d.lora.peer}` : 'Not heard yet'} />
          <Row label="SNR" value={heard ? `${d.lora.snr} dB` : 'Unknown'} />
          <Row label="Last heard" value={d.lora.ageS < 0 ? 'Never' : `${d.lora.ageS}s ago`} tone={stale ? 'warn' : 'default'} />
          <Row label="Packets sent / received" value={`${d.lora.tx} / ${d.lora.rx}`} />
          <Row label="Voice over LoRa" value="Not implemented; telemetry and commands only" />
          <Row label="Selected fallback" value={active ? 'LoRa (laser unavailable or forced RF)' : 'Laser'} tone={active ? 'warn' : 'default'} />
        </div>
      </Panel>
    </div>
  )
}

// ---------- page ----------

export default function LinkDetails() {
  const { latest, connected } = useTelemetry()
  const [tab, setTab] = useState<TabId>('fso')

  if (!latest) {
    return (
      <div className="space-y-6">
        <Header />
        <Panel title="Waiting for data" index={1}>
          <p className="text-[15px]">
            {connected
              ? 'No fresh unit reports. Check unit power and the Bluetooth or USB connection.'
              : `Cannot reach the backend at ${BACKEND_URL}. Start everything with npm run dev from the project root.`}
          </p>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header>
        <Pill tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'}>Active: {latest.activeChannel}</Pill>
        <Pill tone={latest.linkState === 'Locked' ? 'ok' : latest.linkState === 'Failover' ? 'crit' : 'warn'}>{latest.linkState}</Pill>
      </Header>
      <Tabs tab={tab} onChange={setTab} />
      <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'fso' ? <FsoTab /> : <RfTab />}
      </div>
    </div>
  )
}
