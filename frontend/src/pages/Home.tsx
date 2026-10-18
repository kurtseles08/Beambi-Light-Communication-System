import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLink, BACKEND_URL } from '../store/link'
import { useNow } from '../hooks/useNow'
import { useDevice } from '../device/deviceStore'
import Panel from '../components/Panel'
import Gauge from '../components/Gauge'
import MessagesPanel from '../components/MessagesPanel'
import { Bar, Big, Pill, Row, SourceTag, Sub, toneFill, toneSolid, type Tone } from '../components/ui'
import { LINK_STATES, activeAlerts, assessLink, commLabels, formatDuration, type CommLevel } from '../lib/linkStatus'
import type { Direction, LinkState, Settings, UnitStatus } from '../types'

const idx = (i: number) => ({ '--i': i }) as CSSProperties

const MODE_LABEL = { auto: 'Auto', fso: 'Force FSO', rf: 'Force RF' } as const

const STATE_TONE: Record<LinkState, Tone> = {
  Searching: 'default',
  Aligning: 'default',
  Locked: 'ok',
  Degraded: 'warn',
  Failover: 'crit',
  'Re-acquiring': 'warn',
}

const COMM: Record<CommLevel, { tone: Tone; note: string }> = {
  normal: { tone: 'ok', note: 'The optical link is locked and carrying traffic.' },
  degraded: { tone: 'warn', note: 'The link is up but weaker than normal, or the mode was set by hand.' },
  emergency: { tone: 'crit', note: 'The optical link failed. Traffic is running on the RF fallback.' },
  offline: { tone: 'default', note: 'No fresh data from the backend.' },
}

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Home</h1>
        <p className="mt-1 text-[15px] text-moss-600">Is the link working, and are the messages getting through?</p>
      </div>
      <SourceTag />
    </div>
  )
}

// Unit A and Unit B with an arrow showing which way this path carries data
function DirectionPanel({ title, from, to, icon: Arrow, d, index }: {
  title: string; from: string; to: string; icon: LucideIcon; d: Direction; index: number
}) {
  const tone: Tone = !d.connected ? 'crit' : d.packetLoss > 5 ? 'warn' : 'ok'
  return (
    <Panel title={title} tone={tone} index={index} className="lg:col-span-4"
      right={<Pill tone={tone}>{d.connected ? 'Connected' : 'Disconnected'}</Pill>}>
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-forest-800 font-display text-xl font-bold text-white">A</span>
        <div className="relative flex-1">
          <div className={`h-1 rounded-full ${toneFill[tone]}`} />
          <span className="absolute left-1/2 top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-forest-900/15 bg-white text-forest-800">
            <Arrow size={16} />
          </span>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-forest-800 font-display text-xl font-bold text-white">B</span>
      </div>
      <span className="sr-only">{`Data flows from Unit ${from} to Unit ${to}`}</span>
      <Row label="Bitrate" value={`${d.bitrateKbps.toFixed(1)} kbps`} />
      <Row label="Latency" value={`${d.latencyMs} ms`} />
      <Row label="Jitter" value={`${d.jitterMs.toFixed(1)} ms`} />
      <Row label="Packet loss" value={`${d.packetLoss.toFixed(1)}%`} tone={d.packetLoss > 5 ? 'warn' : 'default'} />
    </Panel>
  )
}

function BatteryPanel({ name, u, s, age, index, hw }: { name: string; u: UnitStatus; s: Settings; age: number; index: number; hw: boolean }) {
  // Real hardware: an offline unit, or one with no battery wired, reports no battery value
  const noData = hw && (!u.online || !(u.voltage > 0))
  const tone: Tone = noData ? 'default' : u.battery <= s.critBatteryPct ? 'crit' : u.battery <= s.lowBatteryPct ? 'warn' : 'ok'
  return (
    <Panel title={`Unit ${name} battery`} tone={tone} index={index} className="lg:col-span-3">
      {noData ? (
        <>
          <Big mono>--</Big>
          <Sub>{u.online ? 'No battery reading. Wire the voltage divider to GPIO34.' : `Unit ${name} is offline.`}</Sub>
        </>
      ) : (
        <>
          <Big mono tone={tone}>{u.battery.toFixed(0)}%</Big>
          <div className="mb-3 mt-4"><Bar pct={u.battery} tone={tone} /></div>
          <Row label="Voltage" value={`${u.voltage.toFixed(2)} V`} />
          <Row label="Status" value={u.online ? 'Online' : 'Offline'} tone={u.online ? 'ok' : 'crit'} />
          {!hw && <Row label="Last heard" value={`${age}s ago`} />}
          {(!hw || u.tamper) && <Row label="Enclosure" value={u.tamper ? 'Tampered' : 'Secure'} tone={u.tamper ? 'crit' : 'default'} />}
        </>
      )}
    </Panel>
  )
}

// Hardware mode only: what the real unit knows about its LoRa peer
function LoraSummary({ index }: { index: number }) {
  const d = useDevice((s) => s.device)
  const linked = useDevice((s) => s.deviceConnected)
  if (!linked || !d) {
    return (
      <Panel title="Device" tone="crit" index={index} className="lg:col-span-8">
        <Big stencil size="md" tone="crit">Disconnected</Big>
        <Sub>No reports from the unit shown on the Hardware page. Check its power, Wi-Fi and key (or the USB cable and SERIAL_PATH).</Sub>
      </Panel>
    )
  }
  const heard = d.lora.peer !== '-' && d.lora.ageS >= 0
  const stale = !heard || d.lora.ageS > 10
  const tone: Tone = !d.lora.ok ? 'crit' : stale ? 'warn' : 'ok'
  return (
    <Panel title="LoRa backup" tone={tone} index={index} className="lg:col-span-8"
      right={<Pill tone={tone}>{!d.lora.ok ? 'Module failed' : stale ? 'No peer' : 'Peer online'}</Pill>}>
      <Row label="Peer" value={heard ? `Unit ${d.lora.peer}` : 'Not heard yet'} />
      <Row label="Peer laser" value={heard ? (d.lora.peerLaser ? 'Up' : 'Down') : 'Unknown'} />
      <Row label="Last heard" value={d.lora.ageS < 0 ? 'Never' : `${d.lora.ageS}s ago`} tone={stale ? 'warn' : 'default'} />
      <Row label="Signal" value={heard ? `${d.lora.rssi} dBm · ${d.lora.snr} dB` : 'Unknown'} />
    </Panel>
  )
}

export default function Home() {
  const latest = useLink((s) => s.latest)
  const events = useLink((s) => s.events)
  const messages = useLink((s) => s.messages)
  const filtered = useLink((s) => s.filtered)
  const totals = useLink((s) => s.totals)
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const source = useLink((s) => s.source)
  const now = useNow()
  const hw = source === 'hardware'

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

  const level = assessLink(latest, connected, now)
  const comm = COMM[level]
  const onFso = latest.activeChannel === 'FSO'
  const manual = latest.mode !== 'auto'
  const age = Math.max(0, Math.round((now - latest.ts) / 1000))
  const f = latest.fso
  const zone = f.rssi >= settings.lockAbove ? 'locked' : f.rssi >= settings.failBelow ? 'marginal' : 'fail'
  const zoneTone: Tone = zone === 'locked' ? 'ok' : zone === 'marginal' ? 'warn' : 'crit'
  const alerts = activeAlerts(events, latest.ts)
  const alertTone: Tone = alerts.count === 0 ? 'ok' : alerts.worst?.severity === 'Critical' ? 'crit' : 'warn'
  const session = latest.session
  const lastMessage = messages.at(-1)
  const sinceFailover = session.lastFailoverTs ? (latest.ts - session.lastFailoverTs) / 1000 : null
  const span = 'lg:col-span-3'

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Row 1: the three status readouts */}
        <Panel title="Active channel" tone={onFso ? 'ok' : 'warn'} index={1} className="lg:col-span-4">
          <Big stencil tone={onFso ? 'ok' : 'warn'}>{latest.activeChannel}</Big>
          <Sub>{onFso ? 'Free-space optical link (laser beam)' : 'LoRa radio fallback'}</Sub>
          <div className="mt-4">
            <Row label="Operating mode" value={MODE_LABEL[latest.mode]} tone={manual ? 'warn' : 'default'} />
            <Row label="Codec in use" value={latest.rf.codec} />
          </div>
        </Panel>

        <Panel title="Link state" tone={STATE_TONE[latest.linkState]} index={2} className="lg:col-span-4">
          <Big stencil size="md" tone={STATE_TONE[latest.linkState]}>{latest.linkState}</Big>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {LINK_STATES.map((s) => (
              <span key={s}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-300 ${
                  s === latest.linkState ? toneSolid[STATE_TONE[s]] : 'bg-mint-50 text-moss-600'}`}>
                {s}
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Overall status" tone={comm.tone} index={3} className="lg:col-span-4">
          <Big stencil size="md" tone={comm.tone}>{commLabels[level]}</Big>
          <Sub>{comm.note}</Sub>
          <div className="mt-3">
            <Row label="Last reading" value={`${age}s ago`} tone={age > 5 ? 'crit' : 'default'} />
            {!hw && (
              <>
                <Row label="Last message" value={lastMessage ? `Unit ${lastMessage.to} · ${formatDuration((latest.ts - lastMessage.ts) / 1000)} ago` : 'None yet'} />
                <Row label="Messages received" value={`A ${totals.A.received} · B ${totals.B.received}`} />
              </>
            )}
          </div>
        </Panel>

        {/* Row 2: simulated voice messages (simulator only) */}
        {!hw && (
          <>
            <MessagesPanel unit="A" messages={messages} filtered={filtered} totals={totals.A} now={latest.ts} index={4} />
            <MessagesPanel unit="B" messages={messages} filtered={filtered} totals={totals.B} now={latest.ts} index={5} />
          </>
        )}

        {/* Row 3: signal strength and the data paths */}
        <Panel title="FSO signal strength" tone={zoneTone} index={6} className="lg:col-span-4"
          right={<Pill tone={zoneTone}>{zone === 'locked' ? 'Above lock' : zone === 'marginal' ? 'Marginal' : 'Below failover'}</Pill>}>
          <Gauge value={f.rssi} fail={settings.failBelow} lock={settings.lockAbove} />
          {hw ? (
            <Sub>Derived from the receiver envelope and the link threshold.</Sub>
          ) : (
            <div className="mt-3">
              <Row label="SNR" value={`${f.snr.toFixed(1)} dB`} />
              <Row label="Frame loss" value={`${f.frameLoss.toFixed(1)}%`} tone={f.frameLoss > settings.maxFrameLoss ? 'crit' : 'default'} />
            </div>
          )}
        </Panel>

        {hw ? (
          <LoraSummary index={7} />
        ) : (
          <>
            <DirectionPanel title="Unit A → Unit B" from="A" to="B" icon={ArrowRight} d={latest.ab} index={7} />
            <DirectionPanel title="Unit B → Unit A" from="B" to="A" icon={ArrowLeft} d={latest.ba} index={8} />
          </>
        )}

        {/* Row 4: batteries (simulator only), session, alerts */}
        {!hw && (
          <>
            <BatteryPanel name="A" u={latest.units.A} s={settings} age={age} index={9} hw={hw} />
             <BatteryPanel name="B" u={latest.units.B} s={settings} age={age} index={10} hw={hw} />
          </>
        )}

        <Panel title="Session" index={11} className={span}>
          <Big mono size="md">{formatDuration(session.uptimeSec)}</Big>
          <Sub>System uptime</Sub>
          <div className="mt-3">
            <Row label="Failovers" value={session.failovers} />
          </div>
          <div className="mt-3 text-sm">
            <div className="text-moss-600">Last failover</div>
            {sinceFailover === null ? (
              <div className="font-medium">None this session</div>
            ) : (
              <>
                <div className="font-medium">{session.lastFailoverReason}</div>
                <div className="text-[13px] text-moss-600">{formatDuration(sinceFailover)} ago</div>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Active alerts" tone={alertTone} index={12} className={span}>
          <Big mono tone={alertTone}>{alerts.count}</Big>
          <Sub>{alerts.worst ? `Most severe: ${alerts.worst.severity}` : 'No alerts in the last 5 minutes'}</Sub>
          <ul className="mt-3 space-y-2">
            {alerts.latest.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[13px] leading-snug">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.severity === 'Critical' ? 'bg-crit' : 'bg-warn'}`} />
                <span className="flex-1">{e.message}</span>
                <span className="shrink-0 font-mono text-moss-600">{formatDuration((latest.ts - e.ts) / 1000)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}