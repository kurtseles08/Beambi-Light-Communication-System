import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLink, BACKEND_URL } from '../store/link'
import { useHazards } from '../store/hazards'
import Panel from '../components/Panel'
import { Bar, Big, Pill, Row, SourceTag, Sub, type Tone } from '../components/ui'
import { attenuationOf } from '../lib/environment'

const idx = (i: number) => ({ '--i': i }) as CSSProperties
const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}`

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Environment</h1>
        <p className="mt-1 text-[15px] text-moss-600">What the signal and the weather service can tell. No environment sensors are installed yet.</p>
      </div>
      <SourceTag />
    </div>
  )
}

export default function Environment() {
  const readings = useLink((s) => s.readings)
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const weather = useHazards((s) => s.weather)

  const view = useMemo(() => {
    const last = readings.at(-1)
    if (!last) return null
    const att = readings.map((r) => attenuationOf(r.fso.rssi, settings.clearRssi))
    const w8 = readings.slice(-8).map((r) => r.fso.rssi)
    return {
      rssi: last.fso.rssi,
      att10: mean(att.slice(-10)),
      stepDown: w8.some((v, i) => i > 0 && w8[i - 1] - v >= 15),
    }
  }, [readings, settings.clearRssi])

  if (!view) {
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

  const rain = weather ? weather.precipitation : null
  let label = 'Clear'
  let tone: Tone = 'ok'
  let note = 'The beam has a clean path.'
  if (view.rssi < 8 || (view.stepDown && view.att10 > 30)) {
    label = 'Obstruction'
    tone = 'crit'
    note = 'The signal fell sharply or almost no light arrives. Something may be blocking the beam.'
  } else if (view.att10 >= 12) {
    tone = 'warn'
    if (rain !== null && rain >= 0.2) {
      label = 'Rain'
      note = `The weather service reports ${rain.toFixed(1)} mm of rain in the last hour.`
    } else {
      label = 'Weak signal'
      note = 'The signal is weaker than in clear air. Without a humidity sensor the cause cannot be told apart. Check the aim first.'
    }
  }

  const marginFail = view.rssi - settings.failBelow
  const marginLock = view.rssi - settings.lockAbove
  const marginTone: Tone = view.rssi >= settings.lockAbove ? 'ok' : view.rssi >= settings.failBelow ? 'warn' : 'crit'
  const marginPct = (marginFail / Math.max(1, settings.clearRssi - settings.failBelow)) * 100

  const recent = readings.slice(-120)
  const data = recent.map((r, i) => ({ t: i - (recent.length - 1), loss: attenuationOf(r.fso.rssi, settings.clearRssi) }))
  const first = data.length ? data[0].t : 0
  const ticks = [-120, -90, -60, -30, 0].filter((t) => t >= first)
  const failLoss = attenuationOf(settings.failBelow, settings.clearRssi)
  const tick = { fill: TEXT, fontSize: 12 }

  return (
    <div className="space-y-6">
      <Header />
      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Detected condition" tone={tone} index={1} className="lg:col-span-4" right={<Pill>Estimate</Pill>}>
          <Big stencil size="md" tone={tone}>{label}</Big>
          <Sub>{note}</Sub>
          <div className="mt-3">
            <Row label="Signal lost (10 s average)" value={`${view.att10.toFixed(0)}%`} />
            <Row label="Rain at station (1 h)" value={rain === null ? 'Unknown' : `${rain.toFixed(1)} mm`} />
          </div>
        </Panel>

        <Panel title="Link margin" tone={marginTone} index={2} className="lg:col-span-4"
          right={<Pill tone={marginTone}>{marginTone === 'ok' ? 'Healthy' : marginTone === 'warn' ? 'Shrinking' : 'Below failover'}</Pill>}>
          <Big mono tone={marginTone}>{signed(marginFail)}</Big>
          <Sub>Points of signal above the failover level before the link switches to LoRa.</Sub>
          <div className="my-4"><Bar pct={marginPct} tone={marginTone} /></div>
          <Row label="Current RSSI" value={view.rssi.toFixed(1)} />
          <Row label="Failover level" value={settings.failBelow} />
          <Row label="Lock level" value={settings.lockAbove} />
          <Row label="Margin to lock" value={`${signed(marginLock)} pts`} tone={marginLock >= 0 ? 'ok' : 'warn'} />
        </Panel>

        <Panel title="Sensors" index={3} className="lg:col-span-4">
          <Row label="Temperature and humidity" value="Not installed" />
          <Row label="Ambient light" value="Not installed" />
          <Sub>Add a DHT22 or SHT31 for fog detection, and a BH1750 for ambient light. Each needs a few lines of firmware.</Sub>
        </Panel>

        <Panel title="Attenuation trend" index={4} className="lg:col-span-12">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 0]} ticks={ticks}
                tickFormatter={(v: number) => (v === 0 ? 'now' : `${v}s`)} tick={tick} stroke={GRID} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={42}
                tickFormatter={(v: number) => `${v}%`} tick={tick} stroke={GRID} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
                labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
                formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Signal lost']}
              />
              <Area dataKey="loss" type="monotone" stroke="#d9962b" strokeWidth={2.5} fill="#d9962b" fillOpacity={0.2} isAnimationActive={false} />
              <ReferenceLine y={failLoss} stroke="#9b2c1f" strokeDasharray="6 4" strokeWidth={2}
                label={{ value: 'Failover point', position: 'insideTopLeft', fill: '#9b2c1f', fontSize: 12, fontWeight: 600 }} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[13px] text-moss-600">A slow climb means the air is dimming the beam. A sudden jump means something blocked it.</p>
        </Panel>
      </div>
    </div>
  )
}