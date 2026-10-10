import type { Reading } from '../types'

export type CommLevel = 'normal' | 'degraded' | 'emergency' | 'offline'

export const commLabels: Record<CommLevel, string> = {
  normal: 'Normal',
  degraded: 'Degraded',
  emergency: 'Emergency',
  offline: 'Offline',
}

export function assessLink(latest: Reading | null, connected: boolean, nowMs: number): CommLevel {
  if (!connected || !latest) return 'offline'

  const ageMs = nowMs - latest.ts
  if (ageMs > 15_000) return 'offline'

  switch (latest.linkState) {
    case 'Searching':
    case 'Aligning':
    case 'Re-acquiring':
    case 'Degraded':
      return 'degraded'
    case 'Failover':
      return 'emergency'
    case 'Locked':
    default:
      return 'normal'
  }
}
