import { format } from 'date-fns'
import { ShieldCheck } from 'lucide-react'
import Panel from './Panel'
import { Bar, Pill, toneText, type Tone } from './ui'
import { formatDuration } from '../lib/linkStatus'
import type { FilteredEvent, MessageRecord, UnitId, UnitTotals } from '../types'

const accTone = (a: number): Tone => (a >= 95 ? 'ok' : a >= 80 ? 'warn' : 'crit')
const accLabel = (a: number) => (a >= 95 ? 'Clear' : a >= 80 ? 'Fair' : 'Poor')
const chip = 'rounded-full border border-forest-900/10 bg-white px-2.5 py-1 font-medium text-forest-800'

// Words that did not arrive are marked with ···
function Transcript({ text }: { text: string }) {
  const parts = text.split('\u00b7\u00b7\u00b7')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span title="This part did not arrive" className="mx-0.5 rounded bg-forest-900/10 px-1 font-mono text-moss-600">{'\u00b7\u00b7\u00b7'}</span>
          )}
        </span>
      ))}
    </>
  )
}

function Tile({ label, value, tone = 'default' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-forest-900/10 bg-mint-50 p-3">
      <div className="text-xs text-moss-600">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-medium ${toneText[tone]}`}>{value}</div>
    </div>
  )
}

type Props = {
  unit: UnitId
  messages: MessageRecord[]
  filtered: FilteredEvent[]
  totals: UnitTotals
  now: number // server time of the latest reading
  index: number
}

// What one unit has received. Only messages that pass the encryption check appear here.
export default function MessagesPanel({ unit, messages, filtered, totals, now, index }: Props) {
  const mine = messages.filter((m) => m.to === unit)
  const latest = mine.at(-1)
  const earlier = mine.slice(0, -1).reverse().slice(0, 12)
  // The latest three, plus the most recent stuttered rejection so it never scrolls out of sight
  const mineFiltered = filtered.filter((f) => f.to === unit)
  const recentFiltered = mineFiltered.slice(-3)
  const lastStutter = [...mineFiltered].reverse().find((f) => f.kind === 'stutter')
  const notMessages = (lastStutter && !recentFiltered.includes(lastStutter) ? [lastStutter, ...recentFiltered] : recentFiltered)
    .sort((a, b) => b.ts - a.ts)
  const avg = totals.received ? totals.accuracySum / totals.received : null
  const from = unit === 'A' ? 'B' : 'A'

  return (
    <Panel title={`Unit ${unit}: messages received`} tone={latest ? accTone(latest.accuracy) : 'default'} index={index} className="lg:col-span-6"
      right={<Pill tone={latest ? 'ok' : 'default'}>{latest ? `Last ${formatDuration((now - latest.ts) / 1000)} ago` : 'Listening'}</Pill>}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="Received" value={String(totals.received)} />
        <Tile label="Average accuracy" value={avg === null ? '--' : `${avg.toFixed(1)}%`} tone={avg === null ? 'default' : accTone(avg)} />
        <Tile label="Stuttered, rejected" value={String(totals.stutter)} tone={totals.stutter ? 'warn' : 'default'} />
        <Tile label="Ambient, ignored" value={String(totals.ambient)} />
      </div>

      {latest ? (
        <div key={latest.id} className="rise mt-4 rounded-xl border border-forest-900/15 bg-mint-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[13px] text-moss-600">Message #{latest.seq} · from Unit {latest.from} · via {latest.channel}</div>
            <Pill tone={accTone(latest.accuracy)}>{latest.accuracy.toFixed(1)}% {accLabel(latest.accuracy)}</Pill>
          </div>
          <p className="mt-2 font-display text-2xl font-medium leading-snug"><Transcript text={latest.text} /></p>
          <div className="mt-3"><Bar pct={latest.accuracy} tone={accTone(latest.accuracy)} /></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] text-moss-600">
            <span>{format(latest.ts, 'd MMM yyyy')}</span>
            <span>{format(latest.ts, 'HH:mm:ss')}</span>
            <span>{latest.durationSec} s of voice</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/15 px-2.5 py-1 font-semibold text-ok-ink">
              <ShieldCheck size={13} />Encrypted, {latest.cipher}, verified
            </span>
            <span className={chip}>Signal {latest.rssi.toFixed(0)} · SNR {latest.snr.toFixed(1)} dB</span>
            <span className={chip}>{latest.frames - latest.lost}/{latest.frames} frames · {latest.repaired} repaired</span>
            <span className={chip}>Delay {latest.latencyMs} ms</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-forest-900/20 p-6 text-center text-sm text-moss-600">
          Listening. Nothing has been received at Unit {unit} yet. A message from Unit {from} will appear here.
        </div>
      )}

      {earlier.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Earlier messages</div>
          <ul className="max-h-52 divide-y divide-forest-900/10 overflow-auto rounded-xl border border-forest-900/10">
            {earlier.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="w-[4.6rem] shrink-0 font-mono text-[12px] leading-tight text-moss-600">
                  <div>{format(m.ts, 'HH:mm:ss')}</div>
                  <div>{format(m.ts, 'd MMM')}</div>
                </div>
                <p className="line-clamp-2 flex-1 text-sm"><Transcript text={m.text} /></p>
                <Pill tone={accTone(m.accuracy)}>{m.accuracy.toFixed(0)}%</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-dashed border-forest-900/20 p-3">
        <div className="text-sm font-medium">Not treated as messages</div>
        <p className="text-[13px] leading-snug text-moss-600">
          Stuttered voice and background sound cannot pass the encryption check, so they are rejected or ignored and never shown above.
        </p>
        {notMessages.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px]">
            {notMessages.map((f) => (
              <li key={f.id} className="flex gap-2">
                <span className="shrink-0 font-mono text-moss-600">{format(f.ts, 'HH:mm:ss')}</span>
                <span className={f.kind === 'stutter' ? 'text-warn-ink' : 'text-moss-600'}>{f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
