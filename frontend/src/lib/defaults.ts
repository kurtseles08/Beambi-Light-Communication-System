import type { Settings } from '../types'

// Mirrors backend/src/settings.ts. On the dashboard scale 50 is the unit's real failover point.
export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  failBelow: 50,
  lockAbove: 60,
  clearRssi: 82,
  lowBatteryPct: 20,
  critBatteryPct: 10,
  receiver: 'solar-panel',
}