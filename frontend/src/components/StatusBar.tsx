import { useLink } from '../store/link'
import { useNow } from '../hooks/useNow'

export default function StatusBar() {
  const latest = useLink((s) => s.latest)
  const now = useNow()
  const age = latest ? Math.max(0, Math.round((now - latest.ts) / 1000)) : null

  return (
    <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-forest-900/10 bg-mint-50/70 px-6 py-1.5 text-xs text-moss-600">
      <span>Last reading: {age === null ? 'none' : `${age}s ago`}</span>
      <span className="ml-auto font-mono">BeamBi v0.1</span>
    </footer>
  )
}