import type { CSSProperties } from 'react'
import { format } from 'date-fns'
import { useLink } from '../store/link'
import Panel from '../components/Panel'
import { Pill } from '../components/ui'
import type { Inject } from '../types'

const idx = (i: number) => ({ '--i': i }) as CSSProperties

const controls: { kind: Inject; label: string; hint: string }[] = [
  { kind: 'fog', label: 'Fog', hint: 'Gradual signal loss until you clear it' },
  { kind: 'dust', label: 'Dust or haze', hint: 'Milder gradual loss, low humidity' },
  { kind: 'drift', label: 'Beam drift', hint: 'The mount slowly creeps off target. Re-aim it on Alignment' },
  { kind: 'obstruction', label: 'Block the beam', hint: 'Sudden signal loss for 12 s' },
  { kind: 'glare', label: 'Strong sunlight', hint: 'Ambient light disturbs the receiver' },
  { kind: 'lossburst', label: 'Packet-loss burst', hint: '15 s of lost frames' },
  { kind: 'tamper', label: 'Tamper alert', hint: 'A unit enclosure is opened' },
  { kind: 'lowbattery', label: 'Low battery', hint: 'Unit A drops to the warning level' },
  { kind: 'message', label: 'Send a message', hint: 'A voice message from Unit A or Unit B' },
  { kind: 'stutter', label: 'Stuttered voice', hint: 'Broken audio that must be rejected, never shown as a message' },
  { kind: 'noise', label: 'Ambient noise', hint: 'Background sound that must be ignored' },
  { kind: 'clear', label: 'Clear', hint: 'Back to normal conditions' },
]

const tone = { Info: 'text-forest-800', Warning: 'text-warn-ink', Critical: 'text-crit-ink' } as const

// Temporary until the Settings screen has its own test and demo mode
export default function LiveDebug() {
  const events = useLink((s) => s.events)
  const scenario = useLink((s) => s.scenario)
  const inject = useLink((s) => s.inject)

  return (
    <div className="space-y-6">
      <div className="rise" style={idx(0)}>
        <h1 className="text-3xl font-bold">Demo controls</h1>
        <p className="mt-1 text-[15px] text-moss-600">Temporary. These move into Settings later. Open Home to watch the effect.</p>
      </div>

      <Panel title="Scenarios" index={1} right={<Pill tone={scenario === 'clear' ? 'ok' : 'warn'}>Active: {scenario}</Pill>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {controls.map((c) => (
            <button key={c.kind} onClick={() => inject(c.kind)}
              className="rounded-xl border border-forest-900/15 bg-mint-50 p-3.5 text-left transition-colors hover:border-leaf-500 hover:bg-mint-200">
              <div className="font-display text-lg font-semibold">{c.label}</div>
              <div className="text-[13px] text-moss-600">{c.hint}</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Recent events" index={2}>
        <ul className="max-h-80 space-y-1.5 overflow-auto text-sm">
          {events.length === 0 && <li className="text-moss-600">No events yet</li>}
          {[...events].reverse().slice(0, 30).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="font-mono text-moss-600">{format(e.ts, 'HH:mm:ss')}</span>
              <span className={`w-16 shrink-0 font-semibold ${tone[e.severity]}`}>{e.severity}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
