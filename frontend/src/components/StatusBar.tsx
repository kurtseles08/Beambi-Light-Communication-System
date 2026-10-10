import { useLink } from '../store/link'
import { useNow } from '../hooks/useNow'
import { LOCATION } from '../lib/config'

export default function StatusBar() {
  const latest = useLink((s) => s.latest)
  const source = useLink((s) => s.source)
  const now = useNow()
  const age = latest ? Math.max(0, Math.round((now - latest.ts) / 1000)) : null

  return (
    <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-forest-900/10 bg-mint-50/70 px-6 py-1.5 text-xs text-moss-600">
      {source === 'simulator' && (
        <span className="rounded border border-warn bg-warn/15 px-1.5 font-semibold text-warn-ink">
          SIMULATED DATA
        </span>
      )}
      <span>Last reading: {age === null ? 'none' : `${age}s ago`}</span>
      <span>Station: {LOCATION.name}</span>
      <span className="ml-auto font-mono">BeamBi v0.1</span>
    </footer>
  )
}