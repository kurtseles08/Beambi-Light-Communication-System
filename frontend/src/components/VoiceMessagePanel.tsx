import { useState } from 'react'
import { format } from 'date-fns'
import { Mic, MicOff, Send } from 'lucide-react'
import Panel from './Panel'
import { Bar, Pill, toneText, type Tone } from './ui'
import { sendVoice, useDevice } from '../device/deviceStore'
import { speechSupported, useSpeech } from '../hooks/useSpeech'
import type { UnitId, VoiceRecord } from '../types'

const accTone = (a: number): Tone => (a >= 95 ? 'ok' : a >= 60 ? 'warn' : 'crit')
const accLabel = (r: VoiceRecord) =>
  r.accuracy <= 0 ? 'Not received' : r.accuracy >= 95 ? 'Clear' : r.accuracy >= 60 ? 'Partly received' : 'Poor'

const btn =
  'inline-flex items-center gap-2 rounded-lg border border-forest-900/15 bg-white px-3.5 py-2 text-sm font-medium transition-colors hover:bg-mint-200 disabled:opacity-40 disabled:hover:bg-white'

// Words that did not arrive are marked with ···
function Transcript({ text }: { text: string }) {
  const parts = text.split('\u00b7\u00b7\u00b7')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span title="This part did not arrive" className="mx-0.5 rounded bg-forest-900/10 px-1 font-mono text-moss-600">
              {'\u00b7\u00b7\u00b7'}
            </span>
          )}
        </span>
      ))}
    </>
  )
}

function Box({ role, unit, children, tone = 'default' }: { role: string; unit: UnitId; children: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-forest-900/15 bg-mint-50 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest-800 font-display text-lg font-bold text-white">{unit}</span>
        <div className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">
          Unit {unit} {role}
        </div>
      </div>
      <div className={`mt-3 min-h-[3.5rem] font-display text-2xl font-medium leading-snug ${toneText[tone]}`}>{children}</div>
    </div>
  )
}

export default function VoiceMessagePanel({ index }: { index: number }) {
  const voice = useDevice((s) => s.voice)
  const canCommand = useDevice((s) => s.canCommand)
  const lastError = useDevice((s) => s.lastError)
  const unitsOnline = useDevice((s) => s.unitsOnline)

  const [from, setFrom] = useState<UnitId>('A')
  const [typed, setTyped] = useState('')

  const { listening, interim, error, start, stop } = useSpeech((text, ms) => sendVoice(from, text, ms, 'speech'))

  const latest = voice.at(-1)
  const earlier = voice.slice(0, -1).reverse().slice(0, 10)
  const hearing = listening && interim !== ''

  // What the boxes show: live words while speaking, otherwise the latest finished message
  const txUnit: UnitId = hearing ? from : latest?.from ?? from
  const rxUnit: UnitId = txUnit === 'A' ? 'B' : 'A'
  const rxOnline = unitsOnline[rxUnit]

  const submitTyped = () => {
    const t = typed.trim()
    if (!t) return
    sendVoice(from, t, Math.max(1500, t.split(/\s+/).length * 400), 'typed')
    setTyped('')
  }

  return (
    <Panel
      title="Voice message: transmitted and received"
      index={index}
      className="lg:col-span-12"
      tone={latest ? accTone(latest.accuracy) : 'default'}
      right={<Pill tone={listening ? 'ok' : 'default'}>{listening ? 'Listening' : 'Idle'}</Pill>}
    >
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Speaking at" className="flex items-center gap-2 text-sm text-moss-600">
          Speaking at
          {(['A', 'B'] as UnitId[]).map((u) => (
            <button
              key={u}
              role="radio"
              aria-checked={from === u}
              onClick={() => setFrom(u)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                from === u ? 'border-forest-800 bg-forest-800 text-white' : 'border-forest-900/15 bg-white text-forest-800 hover:bg-mint-200'
              }`}
            >
              Unit {u}
            </button>
          ))}
        </div>
        <button className={btn} disabled={!canCommand || !speechSupported()} onClick={listening ? stop : start}>
          {listening ? <MicOff size={15} /> : <Mic size={15} />}
          {listening ? 'Stop listening' : 'Start listening'}
        </button>
        <form
          className="flex min-w-[16rem] flex-1 gap-2"
          onSubmit={(e) => { e.preventDefault(); submitTyped() }}
        >
          <input
            value={typed}
            maxLength={300}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Or type a message for Unit ${from} to send`}
            className="flex-1 rounded-lg border border-forest-900/15 bg-white px-3 py-1.5 text-sm"
          />
          <button type="submit" className={btn} disabled={!canCommand || !typed.trim()}>
            <Send size={14} /> Send
          </button>
        </form>
      </div>

      {!speechSupported() && (
        <div className="mb-3 rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
          This browser cannot listen to the microphone. Open the dashboard in Chrome or Edge, or type the message instead.
        </div>
      )}
      {error && <div className="mb-3 rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">{error}</div>}
      {lastError && <div className="mb-3 rounded-xl border border-crit bg-crit/15 p-3 text-sm text-crit-ink">{lastError}</div>}
      {!canCommand && (
        <div className="mb-3 rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
          Read-only: the frontend token does not match COMMAND_TOKEN.
        </div>
      )}

      {/* The two lines: transmitter and receiver */}
      <div key={latest?.id ?? 'none'} className="rise grid gap-3 md:grid-cols-2">
        <Box role="Transmitter" unit={txUnit}>
          {hearing ? (
            <span className="italic text-moss-600">{interim}</span>
          ) : latest ? (
            latest.sent
          ) : (
            <span className="text-base text-moss-600">Speak, or type a message. It appears here.</span>
          )}
        </Box>

        <Box role="Receiver" unit={rxUnit} tone={latest && !hearing ? accTone(latest.accuracy) : 'default'}>
          {hearing ? (
            <span className="text-base text-moss-600">Waiting for the sentence to finish...</span>
          ) : latest ? (
            latest.accuracy <= 0 ? (
              <span className="text-base text-crit-ink">
                Nothing arrived. {rxOnline ? 'The laser did not reach the receiver.' : `Unit ${rxUnit} is not reporting.`}
              </span>
            ) : (
              <Transcript text={latest.received} />
            )
          ) : (
            <span className="text-base text-moss-600">The received message appears here.</span>
          )}
        </Box>
      </div>

      {latest && !hearing && (
        <div className="mt-3 rounded-xl border border-forest-900/10 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-moss-600">
            <span>
              Message #{latest.seq} · Unit {latest.from} to Unit {latest.to} · {format(latest.ts, 'd MMM yyyy HH:mm:ss')} ·{' '}
              {latest.source === 'speech' ? 'spoken' : 'typed'}
            </span>
            <Pill tone={accTone(latest.accuracy)}>
              {latest.accuracy.toFixed(0)}% {accLabel(latest)}
            </Pill>
          </div>
          <div className="mt-2"><Bar pct={latest.accuracy} tone={accTone(latest.accuracy)} /></div>
          <div className="mt-2 font-mono text-[12.5px] text-moss-600">
            {latest.samples} receiver report{latest.samples === 1 ? '' : 's'} · signal {latest.signal === null ? '--' : latest.signal.toFixed(0)} ·{' '}
            {latest.durationSec} s
          </div>
        </div>
      )}

      {earlier.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Earlier messages</div>
          <ul className="max-h-64 divide-y divide-forest-900/10 overflow-auto rounded-xl border border-forest-900/10">
            {earlier.map((m) => (
              <li key={m.id} className="grid gap-1 px-3 py-2.5 text-sm md:grid-cols-[5rem_1fr_1fr_auto] md:items-start md:gap-3">
                <div className="font-mono text-[12px] leading-tight text-moss-600">
                  <div>{format(m.ts, 'HH:mm:ss')}</div>
                  <div>{m.from} → {m.to}</div>
                </div>
                <p><span className="text-moss-600">Sent: </span>{m.sent}</p>
                <p><span className="text-moss-600">Received: </span>{m.accuracy <= 0 ? 'Nothing' : <Transcript text={m.received} />}</p>
                <Pill tone={accTone(m.accuracy)}>{m.accuracy.toFixed(0)}%</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[13px] leading-snug text-moss-600">
        The transmitter line is what the browser heard from the person speaking. The receiver line shows only the words that were spoken
        while the other unit&apos;s receiver could see the laser. Gaps are marked ···. Accuracy is an estimate from the unit&apos;s own reports, once per second.
      </p>
    </Panel>
  )
}