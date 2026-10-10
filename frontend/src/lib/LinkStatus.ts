import type { LinkEvent, Reading } from '../types'

export type CommLevel = 'offline' | 'normal' | 'degraded' | 'emergency'

export const commLabels: Record<CommLevel, string> = {
  offline: 'Offline',
  normal: 'Normal',
  degraded: 'Degraded',
  emergency: 'Emergency (RF fallback)',
}

export const commStyles: Record<CommLevel, string> = {
  offline: 'border-slate-700 bg-slate-800 text-slate-300',
  normal: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  degraded: 'border-amber-600 bg-amber-500/10 text-amber-300',
  emergency: 'border-red-600 bg-red-500/10 text-red-300',
}

export function assessLink(latest: Reading | null, connected: boolean, now: number): CommLevel {
  if (!latest || !connected || now - latest.ts > 5000) return 'offline'
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

export function activeAlerts(events: LinkEvent[], now: number, windowMs = 5 * 60 * 1000) {
  const recent = events.filter((e) => e.severity !== 'Info' && now - e.ts <= windowMs)
  const worst = recent.findLast((e) => e.severity === 'Critical') ?? recent.at(-1) ?? null
  return { count: recent.length, worst }
}

export function formatDuration(totalSec: number) {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`
}