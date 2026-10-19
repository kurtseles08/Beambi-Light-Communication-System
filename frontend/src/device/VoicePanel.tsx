import { useEffect } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { format } from 'date-fns'
import Panel from '../components/Panel'
import { Pill, Sub } from '../components/ui'
import { armMic, disarmMic, startTalking, stopTalking, useVoice } from './voice'
import type { UnitId } from '../types'

type Props = { unit: UnitId; disabled: boolean; index?: number; className?: string }

export default function VoicePanel({ unit, disabled, index, className }: Props) {
  const { armed, talking, level, error, clips } = useVoice()

  // Hold Space to talk while the mic is on
  useEffect(() => {
    if (!armed || disabled) return
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target)) return
      e.preventDefault()
      startTalking(unit)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') stopTalking()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', stopTalking)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', stopTalking)
      stopTalking()
    }
  }, [armed, disabled, unit])

  return (
    <Panel
      title={`Voice (Unit ${unit})`}
      tone={talking ? 'crit' : armed ? 'ok' : 'default'}
      index={index}
      className={className}
      right={<Pill tone={talking ? 'crit' : armed ? 'ok' : 'default'}>{talking ? 'Transmitting' : armed ? 'Mic ready' : 'Mic off'}</Pill>}
    >
      {error && <p role="alert" className="mb-3 rounded-xl border border-crit bg-crit/10 p-3 text-sm text-crit-ink">{error}</p>}

      {!armed ? (
        <button
          disabled={disabled}
          onClick={() => void armMic()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-forest-800 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-700 disabled:opacity-40"
        >
          <Mic size={16} /> Enable microphone
        </button>
      ) : (
        <>
          <button
            disabled={disabled}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              startTalking(unit)
            }}
            onPointerUp={stopTalking}
            onPointerCancel={stopTalking}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-full touch-none select-none rounded-2xl border-2 px-4 py-8 font-display text-2xl font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
              talking ? 'border-crit-ink bg-crit text-white' : 'border-forest-800 bg-mint-100 text-forest-800 hover:bg-mint-200'
            }`}
          >
            {talking ? 'Release to stop' : 'Hold to talk'}
          </button>
          <p className="mt-2 text-center text-[13px] text-moss-600">Or hold the Space bar.</p>

          <div className="mt-3" aria-label="Microphone level">
            <div className="h-2.5 overflow-hidden rounded-full bg-forest-900/10">
              <div className="h-full rounded-full bg-leaf-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </div>

          <button
            onClick={disarmMic}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-forest-900/15 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-mint-200"
          >
            <MicOff size={14} /> Turn microphone off
          </button>
        </>
      )}

      <Sub>
        Your laptop microphone is streamed to Unit {unit} as 8 kHz audio, and the unit sends it to the other unit.
        Voice arriving from the hardware plays here automatically.
      </Sub>

      <div className="mt-4 font-display text-sm font-semibold uppercase tracking-[0.14em] text-forest-800">Voice log</div>
      {clips.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-forest-900/20 p-3 text-center text-[13px] text-moss-600">
          Nothing yet. Sent and received voice clips appear here.
        </p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-2 overflow-auto">
          {clips.map((c) => (
            <li key={c.id} className="rounded-xl border border-forest-900/10 p-2.5">
              <div className="mb-1 flex items-center gap-2 text-[13px] text-moss-600">
                <Pill tone={c.dir === 'tx' ? 'ok' : 'default'}>{c.dir === 'tx' ? `Sent via Unit ${c.unit}` : `Received from ${c.unit}`}</Pill>
                <span className="font-mono">{format(c.ts, 'HH:mm:ss')} · {c.seconds.toFixed(1)} s</span>
              </div>
              <audio controls src={c.url} className="h-8 w-full" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}   