import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Droplets, Thermometer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import { useHazards } from '../store/hazards'
import Panel from '../components/Panel'
import { Bar, Big, Pill, Row, SourceTag, Sub, toneSolid, type Tone } from '../components/ui'
import {
  CONDITIONS, attenuationOf, conditionLabel, evaluateEnvironment, type Condition, type Trend,
} from '../lib/environment'

const idx = (i: number) => ({ '--i': i }) as CSSProperties

const CONDITION_TONE: Record<Condition, Tone> = {
  clear: 'ok', fog: 'warn', rain: 'warn', dust: 'warn', obstruction: 'crit', unclear: 'default',
}
const CONDITION_NOTE: Record<Condition, string> = {
  clear: 'The beam has a clean path.',
  fog: 'Water droplets are scattering the beam.',
  rain: 'Rain is scattering and absorbing the beam.',
  dust: 'Dust or haze is dimming the beam.',
  obstruction: 'Something is blocking the beam.',
  unclear: 'The signal is weak, but the cause is not clear.',
}
const TREND_LABEL: Record<Trend, string> = {
  sudden: 'Sudden drop', worsening: 'Getting worse', recovering: 'Recovering', steady: 'Steady',
}
const TREND_TONE: Record<Trend, Tone> = { sudden: 'crit', worsening: 'warn', recovering: 'ok', steady: 'default' }

const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(d)}`

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Environment</h1>
        <p className="mt-1 text-[15px] text-moss-600">Conditions inferred from the signal. These are estimates, not measurements.</p>
      </div>
      <SourceTag />
    </div>
  )
}

function SensorTile({ icon: Icon, label, value, tone = 'default' }: { icon: LucideIcon; label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-forest-900/10 bg-mint-50 p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-moss-600"><Icon size={14} /> {label}</div>
      <div className={`mt-1 font-mono text-3xl font-medium tabular-nums ${tone === 'warn' ? 'text-warn-ink' : tone === 'crit' ? 'text-crit-ink' : 'text-forest-900'}`}>{value}</div>
    </div>
  )
}

export default function Environment() {
  const readings = useLink((s) => s.readings)
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const source = useLink((s) => s.source)
  const scenario = useLink((s) => s.scenario)
  const weather = useHazards((s) => s.weather)

  const rainMm = weather ? weather.precipitation : null
  const env = useMemo(() => evaluateEnvironment(readings, settings, rainMm), [readings, settings, rainMm])

  if (!env) {
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
  const ctone = CONDITION_TONE[env.condition]
  const marginTone: Tone = latest.fso.rssi >= settings.lockAbove ? 'ok' : latest.fso.rssi >= settings.failBelow ? 'warn' : 'crit'
  const marginPct = (env.marginFail / Math.max(1, settings.clearRssi - settings.failBelow)) * 100
  const luxTone: Tone = env.luxLevel === 'Critical' ? 'crit' : env.luxLevel === 'High' ? 'warn' : 'ok'

  const recent = readings.slice(-120)
  const data = recent.map((r, i) => ({
    t: i - (recent.length - 1),
    loss: attenuationOf(r.fso.rssi, settings.clearRssi),
    hum: r.env.humidityPct,
  }))
  const first = data.length ? data[0].t : 0
  const ticks = [-120, -90, -60, -30, 0].filter((t) => t >= first)
  const failLoss = attenuationOf(settings.failBelow, settings.clearRssi)
  const tick = { fill: TEXT, fontSize: 12 }

  const humTone: Tone = env.humidity >= 90 ? 'warn' : 'default'
  const fogRisk = env.spreadC < 2.5 ? 'High' : env.spreadC < 5 ? 'Moderate' : 'Low'

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Detected condition" tone={ctone} index={1} className="lg:col-span-4"
          right={<Pill tone={env.confidence === 'high' ? 'ok' : env.confidence === 'medium' ? 'warn' : 'default'}>Confidence: {env.confidence}</Pill>}>
          <Big stencil size="md" tone={ctone}>{conditionLabel[env.condition]}</Big>
          <Sub>{CONDITION_NOTE[env.condition]}</Sub>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => (
              <span key={c}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-300 ${
                  c === env.condition ? toneSolid[CONDITION_TONE[c]] : 'bg-mint-50 text-moss-600'}`}>
                {conditionLabel[c]}
              </span>
            ))}
          </div>
          <ul className="mt-4 space-y-1.5 text-[13px] leading-snug text-moss-600">
            {env.reasons.map((r) => <li key={r}>• {r}</li>)}
          </ul>
          {source === 'simulator' && (
            <p className="mt-3 border-t border-forest-900/10 pt-3 text-xs text-moss-600">
              Simulator is running: <span className="font-semibold text-forest-800">{scenario}</span>. Use this to check the estimate.
            </p>
          )}
        </Panel>

        <Panel title="Link margin" tone={marginTone} index={2} className="lg:col-span-4"
          right={<Pill tone={marginTone}>{marginTone === 'ok' ? 'Healthy' : marginTone === 'warn' ? 'Shrinking' : 'Below failover'}</Pill>}>
          <Big mono tone={marginTone}>{signed(env.marginFail)}</Big>
          <Sub>Points of signal above the failover level before the link switches to RF.</Sub>
          <div className="my-4"><Bar pct={marginPct} tone={marginTone} /></div>
          <Row label="Current RSSI" value={latest.fso.rssi.toFixed(1)} />
          <Row label="Failover level" value={settings.failBelow} />
          <Row label="Lock level" value={settings.lockAbove} />
          <Row label="Margin to lock" value={`${signed(env.marginLock)} pts`} tone={env.marginLock >= 0 ? 'ok' : 'warn'} />
          <Row label="Time to failover"
            value={env.secondsToFail === null ? 'Not falling' : `about ${Math.max(1, Math.round(env.secondsToFail))} s`}
            tone={env.secondsToFail !== null && env.secondsToFail < 30 ? 'crit' : 'default'} />
        </Panel>

        <Panel title="Ambient light" tone={luxTone} index={3} className="lg:col-span-4"
          right={<Pill tone={luxTone}>{env.luxLevel}</Pill>}>
          <Big mono tone={luxTone}>{env.lux.toLocaleString('en-US')}<span className="ml-2 text-2xl">lx</span></Big>
          <Sub>Background light the receiver has to work against. Sunlight adds noise.</Sub>
          <div className="my-4"><Bar pct={(env.lux / settings.ambientCritLux) * 100} tone={luxTone} /></div>
          <Row label="Noise factor" value={`${env.luxPctOfWarn.toFixed(0)}% of warning level`} tone={luxTone} />
          <Row label="Warning at" value={`${settings.ambientWarnLux.toLocaleString('en-US')} lx`} />
          <Row label="Critical at" value={`${settings.ambientCritLux.toLocaleString('en-US')} lx`} />
          <Row label="Receiver" value={settings.receiver === 'solar-panel' ? 'Solar panel (more sensitive)' : 'Photodiode'} />
        </Panel>

        <Panel title="Attenuation trend" index={4} className="lg:col-span-8"
          right={
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-3 text-xs text-moss-600 sm:flex">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-warn" />Signal lost (left)</span>
                <span className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-[#2b7a9b]" />Humidity (right)</span>
              </div>
              <Pill tone={TREND_TONE[env.trend]}>{TREND_LABEL[env.trend]}</Pill>
            </div>
          }>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-moss-600">
            <span>Signal lost now: <span className="font-mono font-medium text-forest-900">{env.attenuation.toFixed(0)}%</span></span>
            <span>Change: <span className="font-mono font-medium text-forest-900">{signed(env.slopePer10s, 0)} pts per 10 s</span></span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 0]} ticks={ticks}
                tickFormatter={(v: number) => (v === 0 ? 'now' : `${v}s`)} tick={tick} stroke={GRID} />
              <YAxis yAxisId="loss" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={42}
                tickFormatter={(v: number) => `${v}%`} tick={tick} stroke={GRID} />
              <YAxis yAxisId="hum" orientation="right" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={42}
                tickFormatter={(v: number) => `${v}%`} tick={tick} stroke={GRID} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
                labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
                formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === 'loss' ? 'Signal lost' : 'Humidity']}
              />
              <Area yAxisId="loss" dataKey="loss" name="loss" type="monotone" stroke="#d9962b" strokeWidth={2.5}
                fill="#d9962b" fillOpacity={0.2} isAnimationActive={false} />
              <Line yAxisId="hum" dataKey="hum" name="hum" type="monotone" stroke="#2b7a9b" strokeWidth={2}
                dot={false} isAnimationActive={false} />
              <ReferenceLine yAxisId="loss" y={failLoss} stroke="#9b2c1f" strokeDasharray="6 4" strokeWidth={2}
                label={{ value: 'Failover point', position: 'insideTopLeft', fill: '#9b2c1f', fontSize: 12, fontWeight: 600 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[13px] text-moss-600">
            A slow climb suggests fog, rain or dust. A sudden jump suggests an obstruction. Humidity helps tell fog from dust.
          </p>
        </Panel>

        <Panel title="Temperature and humidity" index={5} className="lg:col-span-4"
          right={<Pill>{source === 'simulator' ? 'DHT22 (simulated)' : 'DHT22'}</Pill>}>
          <div className="grid grid-cols-2 gap-2.5">
            <SensorTile icon={Thermometer} label="Temperature" value={`${env.tempC.toFixed(1)} °C`} />
            <SensorTile icon={Droplets} label="Humidity" value={`${env.humidity.toFixed(0)}%`} tone={humTone} />
          </div>
          <div className="mt-4">
            <Row label="Dew point" value={`${env.dewPointC.toFixed(1)} °C`} />
            <Row label="Gap to dew point" value={`${env.spreadC.toFixed(1)} °C`} tone={env.spreadC < 2.5 ? 'warn' : 'default'} />
            <Row label="Fog risk" value={fogRisk} tone={fogRisk === 'High' ? 'warn' : 'default'} />
            {weather && <Row label="Rain at station (1 h)" value={`${weather.precipitation.toFixed(1)} mm`} />}
          </div>
          <p className="mt-3 text-[13px] leading-snug text-moss-600">
            Fog forms when the air cools to within a few degrees of its dew point.
          </p>
        </Panel>
      </div>
    </div>
  )
}
