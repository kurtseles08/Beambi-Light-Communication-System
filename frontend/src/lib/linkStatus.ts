import type { LinkEvent, LinkState, Reading } from '../types'

export type CommLevel = 'offline' | 'normal' | 'degraded' | 'emergency'

export const commLabels: Record<CommLevel, string> = {
  offline: 'Offline',
  normal: 'Normal',
  degraded: 'Degraded',
  emergency: 'Emergency',
}

export const LINK_STATES: LinkState[] = ['Searching', 'Aligning', 'Locked', 'Degraded', 'Failover', 'Re-acquiring']

// Emergency means the system is running on the RF fallback
export function assessLink(latest: Reading | null, connected: boolean, now: number): CommLevel {
  if (!latest || !connected || now - latest.ts > 5000) return 'offline'
  if (latest.mode === 'rf') return 'degraded' // forced by the operator, not a failure
  switch (latest.linkState) {
    case 'Locked':
      return 'normal'
    case 'Failover':
    case 'Re-acquiring':
      return 'emergency'
    default:
      return 'degraded'
  }
}

const rank = { Info: 0, Warning: 1, Critical: 2 } as const

// Warnings and criticals from the last few minutes. `now` should be the server time of the latest reading.
export function activeAlerts(events: LinkEvent[], now: number, windowMs = 5 * 60 * 1000) {
  const recent = events.filter((e) => e.severity !== 'Info' && now - e.ts <= windowMs)
  let worst: LinkEvent | null = null
  for (const e of recent) if (!worst || rank[e.severity] >= rank[worst.severity]) worst = e
  return { count: recent.length, worst, latest: recent.slice(-3).reverse() }
}

export function formatDuration(totalSec: number) {
  const t = Math.max(0, Math.round(totalSec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : m > 0 ? `${m}m ${pad(s)}s` : `${s}s`
}
