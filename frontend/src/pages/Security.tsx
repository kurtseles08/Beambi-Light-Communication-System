import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { format } from 'date-fns'
import { Bar as RBar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import { Big, Pill, Row, SourceTag, Sub, toneText, type Tone } from '../components/ui'
import { formatDuration } from '../lib/linkStatus'
import { NOISE_REF_DBM, evaluateJamming, failuresPerSecond, interruptions } from '../lib/security'
import SecurityHardware from './SecurityHardware'



const idx = (i: number) => ({ '--i': i }) as CSSProperties
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(d)}`
const TEXT = '#4e6b58'

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="mt-1 text-[15px] text-moss-600">Encryption, tamper and jamming indicators.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}<SourceTag /></div>
    </div>
  )
}

function ChannelRow({ name, on, inUse }: { name: string; on: boolean; inUse: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-forest-900/10 py-2.5 last:border-b-0">
      <span className="flex items-center gap-2 text-sm">
        {name}
        {inUse && <span className="rounded-full bg-mint-200 px-2 py-0.5 text-[11px] font-semibold text-forest-800">In use</span>}
      </span>
      <Pill tone={on ? 'ok' : 'crit'}>{on ? 'Encrypted' : 'Not encrypted'}</Pill>
    </div>
  )
}

function UnitTile({ unit, tampered }: { unit: string; tampered: boolean }) {
  const Icon = tampered ? ShieldAlert : ShieldCheck
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3.5 ${tampered ? 'border-crit bg-crit/10' : 'border-forest-900/10 bg-mint-50'}`}>
      <Icon size={26} className={tampered ? 'text-crit-ink' : 'text-ok-ink'} />
      <div>
        <div className="text-[13px] text-moss-600">Unit {unit} enclosure</div>
        <div className={`font-display text-xl font-semibold ${tampered ? 'text-crit-ink' : 'text-forest-900'}`}>
          {tampered ? 'Opened' : 'Secure'}
        </div>
      </div>
    </div>
  )
}

function SecuritySim() {
  const readings = useLink((s) => s.readings)
  const events = useLink((s) => s.events)
  const totals = useLink((s) => s.totals)
  const connected = useLink((s) => s.connected)

  const jam = useMemo(() => evaluateJamming(readings), [readings])
  const perSec = useMemo(() => failuresPerSecond(readings, 60), [readings])
  const blocks = useMemo(() => interruptions(events), [events])

  const latest = readings[readings.length - 1]
  if (!latest || !jam) {
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

  // --- encryption and failed decryptions
  const sec = latest.security
  const allEncrypted = sec.fsoEncrypted && sec.rfEncrypted
  const attempts = sec.framesAuthenticated + sec.failedDecryptions
  const failRate = attempts ? (sec.failedDecryptions / attempts) * 100 : 0
  const okRate = 100 - failRate
  const failTone: Tone = failRate >= 5 ? 'crit' : failRate >= 1 ? 'warn' : 'ok'
  const window60 = perSec.reduce((a, p) => a + p.n, 0)
  const rejectedVoice = totals.A.stutter + totals.B.stutter

  // --- tamper
  const tamperEvents = events.filter((e) => e.type === 'tamper').slice(-6).reverse()
  const tamperTotal = events.filter((e) => e.type === 'tamper').length
  const tamperNow = latest.units.A.tamper || latest.units.B.tamper

  // --- beam interruptions
  const blockedNow = blocks.length > 0 && blocks[blocks.length - 1].durationSec === null
  const done = blocks.filter((b) => b.durationSec !== null)
  const longest = done.reduce((m, b) => Math.max(m, b.durationSec ?? 0), 0)
  const totalBlocked = done.reduce((s, b) => s + (b.durationSec ?? 0), 0)

  // --- jamming
  const jamTone: Tone = jam.verdict === 'suspected' ? 'crit' : jam.verdict === 'possible' ? 'warn' : 'ok'
  const jamLabel = jam.verdict === 'suspected' ? 'Suspected jamming' : jam.verdict === 'possible' ? 'Possible interference' : 'No interference'
  const noiseTone: Tone = jam.noiseLevel === 'crit' ? 'crit' : jam.noiseLevel === 'warn' ? 'warn' : 'default'

  // --- overall
  const overall: Tone =
    tamperNow || !allEncrypted || jam.verdict === 'suspected' ? 'crit'
      : failTone !== 'ok' || jam.verdict === 'possible' || blockedNow ? 'warn' : 'ok'
  const overallLabel = overall === 'crit' ? 'Action needed' : overall === 'warn' ? 'Watch' : 'All clear'

  return (
    <div className="space-y-6">
      <Header><Pill tone={overall}>{overallLabel}</Pill></Header>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Encryption */}
        <Panel title="Encryption status" tone={allEncrypted ? 'ok' : 'crit'} index={1} className="lg:col-span-4"
          right={<Pill tone={allEncrypted ? 'ok' : 'crit'}>{allEncrypted ? 'Protected' : 'Exposed'}</Pill>}>
          <Big stencil size="md" tone={allEncrypted ? 'ok' : 'crit'}>{allEncrypted ? 'Encrypted' : 'Not encrypted'}</Big>
          <Sub>{allEncrypted ? 'Both channels carry encrypted, authenticated frames.' : 'At least one channel is sending readable data.'}</Sub>
          <div className="mt-3">
            <ChannelRow name="FSO (laser)" on={sec.fsoEncrypted} inUse={latest.activeChannel === 'FSO'} />
            <ChannelRow name="LoRa (radio)" on={sec.rfEncrypted} inUse={latest.activeChannel === 'RF'} />
            <Row label="Cipher" value={sec.cipher} />
            <Row label="Frames authenticated" value={sec.framesAuthenticated.toLocaleString('en-US')} />
            <Row label="Authentication success" value={`${okRate.toFixed(2)}%`} tone={failTone === 'ok' ? 'ok' : failTone} />
          </div>
        </Panel>

        {/* Failed decryptions */}
        <Panel title="Failed decryptions" tone={failTone} index={2} className="lg:col-span-4"
          right={<Pill tone={failTone}>{failTone === 'ok' ? 'Normal' : failTone === 'warn' ? 'Elevated' : 'High'}</Pill>}>
          <Big mono tone={failTone}>{sec.failedDecryptions.toLocaleString('en-US')}</Big>
          <Sub>Frames that failed the authentication check this session.</Sub>
          <div className="mt-3 h-[84px]" aria-label="New failed decryptions per second, last 60 seconds" role="img">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perSec} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" tickFormatter={(v: number) => (v === 0 ? 'now' : `${v}s`)} ticks={[-58, -30, 0]}
                  tick={{ fill: TEXT, fontSize: 11 }} stroke="rgba(15,42,26,0.12)" />
                <YAxis hide domain={[0, (max: number) => Math.max(2, max)]} />
                <Tooltip cursor={{ fill: 'rgba(15, 42, 26, 0.06)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
                  labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
                  formatter={(v) => [String(v), 'New failures']} />
                <RBar dataKey="n" fill="#d4492f" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2">
            <Row label="Last 60 s" value={window60} tone={window60 > 5 ? 'warn' : 'default'} />
            <Row label="Failure rate" value={`${failRate.toFixed(2)}%`} tone={failTone === 'ok' ? 'default' : failTone} />
            <Row label="Rejected voice messages" value={rejectedVoice} tone={rejectedVoice ? 'warn' : 'default'} />
          </div>
        </Panel>

        {/* Jamming */}
        <Panel title="System jamming" tone={jamTone} index={3} className="lg:col-span-4"
          right={<Pill tone={jamTone}>{jam.verdict === 'clear' ? 'Clear' : jam.verdict === 'possible' ? 'Watch' : 'Alert'}</Pill>}>
          <Big stencil size="md" tone={jamTone}>{jamLabel}</Big>
          <Sub>These are warning signs. They cannot prove that someone is jamming on purpose.</Sub>
          <div className="mt-3">
            <Row label="RF noise floor" value={`${jam.noiseFloorDbm.toFixed(1)} dBm (${signed(jam.riseDb)} dB)`} tone={noiseTone} />
            <Row label="Hop sync"
              value={jam.syncLosses === 0 ? 'In sync' : `Lost ${jam.syncLosses}\u00d7 in 30 s`}
              tone={jam.syncBad ? 'warn' : 'default'} />
            <Row label="RF packet loss"
              value={jam.rfLossPct === null ? 'Idle, on FSO' : `${jam.rfLossPct.toFixed(1)}%`}
              tone={jam.lossBad ? 'warn' : 'default'} />
          </div>
          <div className="mt-4 border-t border-forest-900/10 pt-3">
            <div className="mb-2 flex items-baseline justify-between text-[13px] text-moss-600">
              <span>Noise by hop channel, last 2 min</span>
              <span>{jam.worst ? `Highest: ch ${jam.worst.channel} (${signed(jam.worst.riseDb ?? 0)} dB)` : 'Collecting...'}</span>
            </div>
            <div className="flex h-20 items-end gap-1.5" role="img" aria-label="Noise floor on each hop channel, compared with normal">
              {jam.channels.map((c) => {
                const rise = c.riseDb
                const tone = rise === null ? 'bg-forest-900/10' : rise >= 15 ? 'bg-crit' : rise >= 8 ? 'bg-warn' : 'bg-leaf-500'
                const h = rise === null ? 6 : Math.min(100, Math.max(6, ((rise + 10) / 30) * 100))
                return <div key={c.channel} className={`flex-1 rounded-t ${tone}`} style={{ height: `${h}%` }}
                  title={rise === null ? `Channel ${c.channel}: no samples` : `Channel ${c.channel}: ${signed(rise)} dB vs normal`} />
              })}
            </div>
            <div className="mt-1 flex gap-1.5 font-mono text-[11px] text-moss-600">
              {jam.channels.map((c) => <span key={c.channel} className="flex-1 text-center">{c.channel}</span>)}
            </div>
            <p className="mt-2 text-xs text-moss-600">Normal is {NOISE_REF_DBM} dBm. One tall bar means one channel is being disturbed.</p>
          </div>
        </Panel>

        {/* Tamper */}
        <Panel title="Tamper alerts" tone={tamperNow ? 'crit' : 'ok'} index={4} className="lg:col-span-6"
          right={<Pill tone={tamperNow ? 'crit' : tamperTotal ? 'warn' : 'ok'}>{tamperNow ? 'Alarm active' : `${tamperTotal} this session`}</Pill>}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <UnitTile unit="A" tampered={latest.units.A.tamper} />
            <UnitTile unit="B" tampered={latest.units.B.tamper} />
          </div>
          <div className="mt-4 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Recent alerts</div>
          {tamperEvents.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-forest-900/20 p-4 text-center text-sm text-moss-600">
              No tamper alerts this session. An alert appears here when a unit enclosure is opened.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-forest-900/10 rounded-xl border border-forest-900/10">
              {tamperEvents.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <span className="shrink-0 font-mono text-[13px] text-moss-600">{format(e.ts, 'HH:mm:ss')}</span>
                  <span className="shrink-0 rounded-full bg-crit/15 px-2 py-0.5 text-xs font-semibold text-crit-ink">Unit {e.unit}</span>
                  <span className="flex-1">{e.message}</span>
                  <span className="shrink-0 font-mono text-[13px] text-moss-600">{formatDuration((latest.ts - e.ts) / 1000)} ago</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Beam interruptions */}
        <Panel title="Beam interruption events" tone={blockedNow ? 'crit' : blocks.length ? 'warn' : 'ok'} index={5} className="lg:col-span-6"
          right={<Pill tone={blockedNow ? 'crit' : 'ok'}>{blockedNow ? 'Beam blocked' : 'Beam clear'}</Pill>}>
          <div className="grid grid-cols-3 gap-2.5 text-center">
            {[
              ['Events', String(blocks.length)],
              ['Longest', done.length ? formatDuration(longest) : '--'],
              ['Total blocked', done.length ? formatDuration(totalBlocked) : '--'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-forest-900/10 bg-mint-50 p-3">
                <div className="text-xs text-moss-600">{label}</div>
                <div className="mt-0.5 font-mono text-xl font-medium">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Recent interruptions</div>
          {blocks.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-forest-900/20 p-4 text-center text-sm text-moss-600">
              No interruptions yet. An event appears when the optical signal drops to almost nothing.
            </p>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-forest-900/10 overflow-auto rounded-xl border border-forest-900/10">
              {[...blocks].reverse().slice(0, 10).map((b) => {
                const ongoing = b.durationSec === null
                const secs = ongoing ? Math.max(0, Math.round((latest.ts - b.start) / 1000)) : b.durationSec ?? 0
                return (
                  <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="shrink-0 font-mono text-[13px] text-moss-600">{format(b.start, 'HH:mm:ss')}</span>
                    <span className={`flex-1 font-medium ${ongoing ? toneText.crit : ''}`}>
                      {ongoing ? 'Blocked right now' : 'Beam restored'}
                    </span>
                    <span className="shrink-0 font-mono">{formatDuration(secs)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

export default function Security() {
  const source = useLink((s) => s.source)
  return source === 'hardware' ? <SecurityHardware /> : <SecuritySim />
}