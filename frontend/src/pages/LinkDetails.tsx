import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { format } from 'date-fns'
import { Pause, Play } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLink, BACKEND_URL } from '../store/link'
import Panel from '../components/Panel'
import Gauge from '../components/Gauge'
import { Bar, Big, Pill, Row, SourceTag, Sub, toneChip, toneText, type Tone } from '../components/ui'
import type { Direction, PacketRecord } from '../types'
import { useDevice } from '../device/deviceStore'



const idx = (i: number) => ({ '--i': i }) as CSSProperties

// ---------- helpers ----------

const SUP: Record<string, string> = { '-': '\u207b', '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' }

// 3.2e-4 -> 3.2×10⁻⁴
function formatBer(v: number) {
  const [m, e] = v.toExponential(1).split('e')
  return `${m}\u00d710${[...String(Number(e))].map((c) => SUP[c] ?? c).join('')}`
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

const berTone = (v: number): Tone => (v < 1e-6 ? 'ok' : v < 1e-3 ? 'warn' : 'crit')
const snrTone = (v: number): Tone => (v >= 12 ? 'ok' : v >= 5 ? 'warn' : 'crit')
const rfTone = (dbm: number): Tone => (dbm > -100 ? 'ok' : dbm > -110 ? 'warn' : 'crit')

const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'

// The simulator hops across 8 channels. Change this when the firmware's hop table is known.
const HOP_CHANNELS = 8

const TABS = [
  { id: 'fso', label: 'FSO' },
  { id: 'rf', label: 'RF (LoRa)' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'packets', label: 'Packet log' },
] as const
type TabId = (typeof TABS)[number]['id']

// ---------- header and tabs ----------

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
      <div>
        <h1 className="text-3xl font-bold">Link Details</h1>
        <p className="mt-1 text-[15px] text-moss-600">FSO and LoRa metrics, transfer counters, and the packet log.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <SourceTag />
      </div>
    </div>
  )
}

function Tabs({ tab, tabs, onChange }: { tab: TabId; tabs: readonly { id: TabId; label: string }[]; onChange: (t: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Link detail sections" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
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

function SignalTrend({ data, hw }: { data: { t: number; rssi: number; snr: number }[]; hw: boolean }) {
  const tick = { fill: TEXT, fontSize: 12 }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 0]} ticks={[-60, -45, -30, -15, 0]}
          tickFormatter={(v: number) => (v === 0 ? 'now' : `${v}s`)} tick={tick} stroke={GRID} />
        <YAxis yAxisId="rssi" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={38} tick={tick} stroke={GRID} />
        {!hw && <YAxis yAxisId="snr" orientation="right" domain={[-5, 30]} width={38} tick={tick} stroke={GRID} />}
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
          labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
          formatter={(value, name) => [Number(value).toFixed(1), name === 'rssi' ? 'RSSI' : 'SNR (dB)']}
        />
        <Line yAxisId="rssi" dataKey="rssi" name="rssi" stroke="#3fae63" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        {!hw && <Line yAxisId="snr" dataKey="snr" name="snr" stroke="#d9962b" strokeWidth={2} dot={false} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  )
}

function FsoTab({ hw }: { hw: boolean }) {
  const readings = useLink((s) => s.readings)
  const settings = useLink((s) => s.settings)
  const latest = readings[readings.length - 1]
  const f = latest.fso

  const zone = f.rssi >= settings.lockAbove ? 'locked' : f.rssi >= settings.failBelow ? 'marginal' : 'fail'
  const zoneTone: Tone = zone === 'locked' ? 'ok' : zone === 'marginal' ? 'warn' : 'crit'
  const gain = f.berPost > 0 ? Math.log10(f.berPre / f.berPost) : 0
  const lossTone: Tone = f.frameLoss > settings.maxFrameLoss ? 'crit' : f.frameLoss > 5 ? 'warn' : 'default'
  const luxTone: Tone = f.ambientLux >= settings.ambientCritLux ? 'crit' : f.ambientLux >= settings.ambientWarnLux ? 'warn' : 'default'
  const half = hw ? 'lg:col-span-6' : 'lg:col-span-4'

  const recent = readings.slice(-60)
  const data = recent.map((r, i) => ({ t: i - (recent.length - 1), rssi: r.fso.rssi, snr: r.fso.snr }))

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Panel title="Optical signal" tone={zoneTone} index={1} className={half}
        right={<Pill tone={zoneTone}>{zone === 'locked' ? 'Above lock' : zone === 'marginal' ? 'Marginal' : 'Below failover'}</Pill>}>
        <Gauge value={f.rssi} fail={settings.failBelow} lock={settings.lockAbove} />
        <div className="mt-3">
          <Row label="RSSI" value={f.rssi.toFixed(1)} tone={zoneTone} />
          {!hw && <Row label="SNR" value={`${f.snr.toFixed(1)} dB`} tone={snrTone(f.snr)} />}
          {!hw && <Row label="Frame loss" value={`${f.frameLoss.toFixed(1)}%`} tone={lossTone} />}
        </div>
      </Panel>

      {!hw && (
        <Panel title="Error correction (FEC)" tone={berTone(f.berPost)} index={2} className="lg:col-span-4">
          <Big mono size="md" tone={berTone(f.berPost)}>{formatBer(f.berPost)}</Big>
          <Sub>Bit error rate after error correction. Lower is better.</Sub>
          <div className="mt-4">
            <Row label="BER before FEC" value={formatBer(f.berPre)} tone={berTone(f.berPre)} />
            <Row label="BER after FEC" value={formatBer(f.berPost)} tone={berTone(f.berPost)} />
            <Row label="FEC improvement" value={gain >= 0.05 ? `${gain.toFixed(1)} orders of magnitude` : 'Little effect'} />
          </div>
        </Panel>
      )}

      <Panel title="Hardware status" index={3} className={half}
        right={hw
          ? <Pill tone={f.laserOk ? 'ok' : 'warn'}>{f.laserOk ? 'Link up' : 'Link down'}</Pill>
          : <Pill tone={f.laserOk && f.rxPresent ? 'ok' : 'crit'}>{f.laserOk && f.rxPresent ? 'All good' : 'Check'}</Pill>}>
        {hw ? (
          <>
            <Row label="Laser link" value={f.laserOk ? 'Up' : 'Down'} tone={f.laserOk ? 'ok' : 'warn'} />
            <Row label="Receiver type" value={settings.receiver === 'solar-panel' ? 'Solar panel' : 'Photodiode'} />
            <Row label="Carrying traffic" value={latest.activeChannel === 'FSO' ? 'Yes' : 'No, on RF fallback'}
              tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'} />
          </>
        ) : (
          <>
            <Row label="Laser transmitter" value={f.laserOk ? 'OK' : 'Fault'} tone={f.laserOk ? 'ok' : 'crit'} />
            <Row label="Optical receiver" value={f.rxPresent ? 'Light detected' : 'No light'} tone={f.rxPresent ? 'ok' : 'crit'} />
            <Row label="Receiver type" value={settings.receiver === 'solar-panel' ? 'Solar panel' : 'Photodiode'} />
            <Row label="Ambient light" value={`${f.ambientLux.toLocaleString('en-US')} lx`} tone={luxTone} />
            <Row label="Carrying traffic" value={latest.activeChannel === 'FSO' ? 'Yes' : 'No, on RF fallback'}
              tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'} />
          </>
        )}
      </Panel>

      <Panel title={hw ? 'RSSI, last 60 seconds' : 'RSSI and SNR, last 60 seconds'} index={4} className="lg:col-span-12"
        right={
          <div className="hidden items-center gap-3 text-xs text-moss-600 sm:flex">
            <span className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-leaf-500" />RSSI{hw ? '' : ' (left)'}</span>
            {!hw && <span className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-warn" />SNR in dB (right)</span>}
          </div>
        }>
        <SignalTrend data={data} hw={hw} />
      </Panel>
    </div>
  )
}

// ---------- RF tab ----------

// Real hardware: show what the unit's own LoRa module reports about its peer
function RfTabHardware() {
  const d = useDevice((s) => s.device)
  const linked = useDevice((s) => s.deviceConnected)
  const latest = useLink((s) => s.latest)!
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
          <Row label="Carrying traffic" value={active ? 'Yes, the laser is down' : 'No, standby'} tone={active ? 'warn' : 'default'} />
        </div>
      </Panel>
    </div>
  )
}

function RfTab({ hw }: { hw: boolean }) {
  return hw ? <RfTabHardware /> : <RfTabSim />
}

function RfTabSim() {
  const latest = useLink((s) => s.latest)!
  const rf = latest.rf
  const active = latest.activeChannel === 'RF'

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Panel title="LoRa radio" tone={active ? 'warn' : 'default'} index={1} className="lg:col-span-6"
        right={<Pill tone={active ? 'warn' : 'default'}>{active ? 'Carrying traffic' : 'Standby'}</Pill>}>
        <Big mono tone={rfTone(rf.rssi)}>{rf.rssi.toFixed(1)}<span className="ml-2 text-2xl">dBm</span></Big>
        <Sub>Received signal strength of the radio fallback. Closer to 0 is stronger.</Sub>
        <div className="mt-4">
          <Row label="SNR" value={`${rf.snr.toFixed(1)} dB`} tone={rf.snr >= 5 ? 'default' : 'warn'} />
          <Row label="Voice codec" value={rf.codec} />
          <Row label="Encryption" value={rf.encrypted ? `On, ${latest.security.cipher}` : 'Off'} tone={rf.encrypted ? 'ok' : 'crit'} />
          <Row label="Retransmissions" value={rf.retransmissions.toLocaleString('en-US')} />
        </div>
      </Panel>

      <Panel title="Frequency hopping" tone={rf.hopSync ? 'ok' : 'crit'} index={2} className="lg:col-span-6"
        right={<Pill tone={rf.hopSync ? 'ok' : 'crit'}>{rf.hopSync ? 'In sync' : 'Lost sync'}</Pill>}>
        <div className="flex items-baseline gap-3">
          <Big mono tone={rf.hopSync ? 'default' : 'crit'}>{rf.channel}</Big>
          <span className="text-sm text-moss-600">Current hop channel</span>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8" role="img" aria-label={`Hop channel ${rf.channel} of ${HOP_CHANNELS}`}>
          {Array.from({ length: HOP_CHANNELS }, (_, c) => (
            <div key={c}
              className={`grid h-12 place-items-center rounded-lg border font-mono text-sm transition-colors duration-200 ${
                c === rf.channel
                  ? (rf.hopSync ? 'border-leaf-600 bg-leaf-500 font-semibold text-white' : 'border-crit bg-crit text-white')
                  : 'border-forest-900/10 bg-mint-50 text-moss-600'}`}>
              {c}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Row label="Hop synchronization" value={rf.hopSync ? 'Both units on the same channel' : 'Units out of step'} tone={rf.hopSync ? 'ok' : 'crit'} />
          <Row label="Channels in hop table" value={HOP_CHANNELS} />
        </div>
      </Panel>
    </div>
  )
}

// ---------- Transfer tab ----------

function TransferPanel({ title, d, index, active }: { title: string; d: Direction; index: number; active: string }) {
  const ratio = d.framesSent ? (d.framesReceived / d.framesSent) * 100 : 100
  const tone: Tone = !d.connected ? 'crit' : d.packetLoss > 5 ? 'warn' : 'ok'
  return (
    <Panel title={title} tone={tone} index={index} className="lg:col-span-6"
      right={<Pill tone={tone}>{d.connected ? `Connected on ${active}` : 'Disconnected'}</Pill>}>
      <div className="flex items-baseline justify-between">
        <Big mono size="md" tone={ratio >= 95 ? 'ok' : ratio >= 80 ? 'warn' : 'crit'}>{ratio.toFixed(1)}%</Big>
        <span className="text-sm text-moss-600">Delivered this session</span>
      </div>
      <div className="mb-4 mt-3"><Bar pct={ratio} tone={ratio >= 95 ? 'ok' : ratio >= 80 ? 'warn' : 'crit'} /></div>
      <Row label="Frames sent" value={d.framesSent.toLocaleString('en-US')} />
      <Row label="Frames received" value={d.framesReceived.toLocaleString('en-US')} />
      <Row label="Frames lost" value={d.framesLost.toLocaleString('en-US')} tone={d.framesLost > 0 ? 'warn' : 'default'} />
      <Row label="Data received" value={formatBytes(d.bytes)} />
      <Row label="Live bitrate" value={`${d.bitrateKbps.toFixed(1)} kbps`} />
      <Row label="Latency / jitter" value={`${d.latencyMs} ms / ${d.jitterMs.toFixed(1)} ms`} />
      <Row label="Packet loss (now)" value={`${d.packetLoss.toFixed(1)}%`} tone={d.packetLoss > 5 ? 'warn' : 'default'} />
    </Panel>
  )
}

function TransferTab() {
  const latest = useLink((s) => s.latest)!
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <TransferPanel title="Unit A → Unit B" d={latest.ab} index={1} active={latest.activeChannel} />
      <TransferPanel title="Unit B → Unit A" d={latest.ba} index={2} active={latest.activeChannel} />
    </div>
  )
}

// ---------- Packet log tab ----------

type Dir = 'all' | PacketRecord['dir']
type Chan = 'all' | PacketRecord['channel']
type Stat = 'all' | PacketRecord['status']

const statusTone: Record<PacketRecord['status'], Tone> = { Delivered: 'ok', Corrected: 'warn', Lost: 'crit' }
const crcClass: Record<PacketRecord['crc'], string> = {
  OK: 'text-forest-900', 'FEC corrected': 'text-warn-ink', 'CRC fail': 'text-crit-ink', '\u2014': 'text-moss-600',
}
const select = 'rounded-lg border border-forest-900/15 bg-white px-2.5 py-1.5 text-sm font-medium text-forest-900'
const MAX_ROWS = 100

function PacketsTab() {
  const live = useLink((s) => s.packets)
  const [frozen, setFrozen] = useState<PacketRecord[] | null>(null)
  const [dir, setDir] = useState<Dir>('all')
  const [chan, setChan] = useState<Chan>('all')
  const [stat, setStat] = useState<Stat>('all')

  const source = frozen ?? live
  const rows = source
    .filter((p) => (dir === 'all' || p.dir === dir) && (chan === 'all' || p.channel === chan) && (stat === 'all' || p.status === stat))
    .slice(-MAX_ROWS)
    .reverse()

  const count = (s: PacketRecord['status']) => source.filter((p) => p.status === s).length

  return (
    <Panel title="Packet log" index={1}
      right={<Pill tone={frozen ? 'warn' : 'ok'}>{frozen ? 'Paused' : 'Live'}</Pill>}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 text-sm text-moss-600">Direction
          <select className={select} value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
            <option value="all">All</option><option value="A→B">A → B</option><option value="B→A">B → A</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-moss-600">Channel
          <select className={select} value={chan} onChange={(e) => setChan(e.target.value as Chan)}>
            <option value="all">All</option><option value="FSO">FSO</option><option value="RF">RF</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-moss-600">Status
          <select className={select} value={stat} onChange={(e) => setStat(e.target.value as Stat)}>
            <option value="all">All</option><option value="Delivered">Delivered</option>
            <option value="Corrected">Corrected</option><option value="Lost">Lost</option>
          </select>
        </label>
        <button onClick={() => setFrozen(frozen ? null : live)}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-forest-900/15 bg-white px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-mint-200">
          {frozen ? <Play size={15} /> : <Pause size={15} />}{frozen ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${toneChip.ok}`}>Delivered {count('Delivered')}</span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${toneChip.warn}`}>Corrected {count('Corrected')}</span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${toneChip.crit}`}>Lost {count('Lost')}</span>
        <span className="px-1 py-1 text-moss-600">of the last {source.length} logged frames. One sample frame per direction each second.</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-forest-900/20 p-6 text-center text-sm text-moss-600">
          {source.length === 0 ? 'Waiting for the first packets.' : 'No packets match these filters. Set a filter back to All.'}
        </div>
      ) : (
        <div className="max-h-[30rem] overflow-auto rounded-xl border border-forest-900/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-mint-50 text-[13px] text-moss-600">
              <tr>
                {['Time', 'Direction', 'Channel', 'Sequence', 'Size', 'CRC / FEC', 'Status'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-900/10 font-mono tabular-nums">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 text-moss-600">{format(p.ts, 'HH:mm:ss')}</td>
                  <td className="px-3 py-1.5">{p.dir}</td>
                  <td className="px-3 py-1.5">{p.channel}</td>
                  <td className="px-3 py-1.5">{p.seq.toLocaleString('en-US')}</td>
                  <td className="px-3 py-1.5">{p.size} B</td>
                  <td className={`px-3 py-1.5 ${crcClass[p.crc]}`}>{p.crc}</td>
                  <td className="px-3 py-1.5"><span className={`font-sans font-semibold ${toneText[statusTone[p.status]]}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---------- page ----------

export default function LinkDetails() {
  const latest = useLink((s) => s.latest)
  const connected = useLink((s) => s.connected)
  const source = useLink((s) => s.source)
  const [tab, setTab] = useState<TabId>('fso')
  const hw = source === 'hardware'
  const tabs = hw ? TABS.filter((t) => t.id === 'fso' || t.id === 'rf') : TABS
  const shown: TabId = tabs.some((t) => t.id === tab) ? tab : 'fso'

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

  return (
    <div className="space-y-6">
      <Header>
        <Pill tone={latest.activeChannel === 'FSO' ? 'ok' : 'warn'}>Active: {latest.activeChannel}</Pill>
        <Pill tone={latest.linkState === 'Locked' ? 'ok' : latest.linkState === 'Failover' ? 'crit' : 'warn'}>{latest.linkState}</Pill>
      </Header>
      <Tabs tab={shown} tabs={tabs} onChange={setTab} />
      <div key={shown} role="tabpanel" id={`panel-${shown}`} aria-labelledby={`tab-${shown}`}>
        {shown === 'fso' && <FsoTab hw={hw} />}
        {shown === 'rf' && <RfTab hw={hw} />}
        {shown === 'transfer' && <TransferTab />}
        {shown === 'packets' && <PacketsTab />}
      </div>
    </div>
  )
}
