import type { CSSProperties } from 'react'
import { useLink, BACKEND_URL } from '../store/link'
import { useNow } from '../hooks/useNow'
import { useDevice } from '../device/deviceStore'
import Panel from '../components/Panel'
import Gauge from '../components/Gauge'
import { Big, Pill, Row, SourceTag, Sub, toneSolid, type Tone } from '../components/ui'
import { LINK_STATES, activeAlerts, assessLink, commLabels, formatDuration, type CommLevel } from '../lib/linkStatus'
import type { LinkState } from '../types'

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
  emergency: { tone: 'crit', note: 'The optical link failed. LoRa carries telemetry only; voice is unavailable until the laser link recovers.' },
  offline: { tone: 'default', note: 'No fresh data from the backend.' },
}

function Header() {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Home</h1>
        <p className="mt-1 text-[15px] text-moss-600">Is the link working right now?</p>
      </div>
      <SourceTag />
    </div>
  )
}

// What the real unit knows about its LoRa peer
function LoraSummary({ index }: { index: number }) {
  const d = useDevice((s) => s.device)
  const linked = useDevice((s) => s.deviceConnected)
  if (!linked || !d) {
    return (
      <Panel title="Device" tone="crit" index={index} className="lg:col-span-8">
        <Big stencil size="md" tone="crit">Disconnected</Big>
        <Sub>No reports from the summary unit. Check battery power, laptop Bluetooth and the connection to Unit A. For Unit B, check its LoRa link to Unit A. See the Hardware page for connection guidance.</Sub>
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
  const connected = useLink((s) => s.connected)
  const settings = useLink((s) => s.settings)
  const now = useNow()

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
  const sinceFailover = session.lastFailoverTs ? (latest.ts - session.lastFailoverTs) / 1000 : null

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel title="Active channel" tone={onFso ? 'ok' : 'warn'} index={1} className="lg:col-span-4">
          <Big stencil tone={onFso ? 'ok' : 'warn'}>{latest.activeChannel}</Big>
          <Sub>{onFso ? 'Free-space optical link (laser beam)' : 'LoRa telemetry; voice needs the laser link'}</Sub>
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
          </div>
        </Panel>

        <Panel title="FSO signal strength" tone={zoneTone} index={4} className="lg:col-span-4"
          right={<Pill tone={zoneTone}>{zone === 'locked' ? 'Above lock' : zone === 'marginal' ? 'Marginal' : 'Below failover'}</Pill>}>
          <Gauge value={f.rssi} fail={settings.failBelow} lock={settings.lockAbove} />
          <Sub>Weakest of the two receivers, 0 to 100. 50 is the unit's failover point.</Sub>
<div className="mt-3">
  {(['A', 'B'] as const).map((u) => {
    const x = latest.units[u]
    return (
      <Row key={u} label={`Unit ${u} receiver`}
        value={x.online ? `${x.rssi.toFixed(1)} · laser ${x.laser ? 'up' : 'down'}` : 'Offline'}
        tone={!x.online ? 'default' : x.laser ? 'ok' : 'warn'} />
    )
  })}
</div>
        </Panel>

        <LoraSummary index={5} />

        <Panel title="Session" index={6} className="lg:col-span-6">
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

        <Panel title="Active alerts" tone={alertTone} index={7} className="lg:col-span-6">
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
