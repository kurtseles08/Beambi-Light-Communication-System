import { format } from 'date-fns'
import { useLink } from '../store/link'

const buttons = [
  ['fog', 'Simulate fog'],
  ['obstruction', 'Block beam'],
  ['clear', 'Clear'],
] as const

export default function LiveDebug() {
  const latest = useLink((s) => s.latest)
  const events = useLink((s) => s.events)
  const inject = useLink((s) => s.inject)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Live feed (temporary)</h1>
        <p className="text-sm text-slate-400">
          Raw simulator data. The real Home screen replaces this in the next step.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {buttons.map(([kind, label]) => (
          <button
            key={kind}
            onClick={() => inject(kind)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          >
            {label}
          </button>
        ))}
      </div>

      {latest && (
        <div className="text-lg font-semibold">
          {latest.activeChannel} · {latest.linkState} · FSO signal {latest.fso.rssi}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs">
          {latest ? JSON.stringify(latest, null, 2) : 'Waiting for data...'}
        </pre>
        <ul className="max-h-96 space-y-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
          {events.length === 0 && <li className="text-slate-500">No events yet</li>}
          {[...events].reverse().map((e) => (
            <li key={e.id}>
              <span className="text-slate-500">{format(e.ts, 'hh:mm:ss a')}</span>{' '}
              <span
                className={
                  e.severity === 'Critical'
                    ? 'text-red-400'
                    : e.severity === 'Warning'
                      ? 'text-amber-400'
                      : 'text-sky-400'
                }
              >
                [{e.severity}]
              </span>{' '}
              {e.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}