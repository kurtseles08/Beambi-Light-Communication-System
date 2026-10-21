import type { Reading } from '../types'

export function isFresh(reading: { ts?: number } | null, connected: boolean, now: number): boolean {
  // The UI clock ticks once a second; a newly received report can be newer
  // than that last tick. Do not briefly hide it until the next clock update.
  return connected && reading?.ts !== undefined && now - reading.ts < 5000
}

export function recentReadings(readings: Reading[], seconds: number): Reading[] {
  const last = readings.at(-1)
  return last ? readings.filter((r) => r.ts > last.ts - seconds * 1000) : []
}
