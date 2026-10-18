import type { Settings } from '../types'

// Mirrors backend/src/settings.ts. The backend sends the real values when the page connects.
export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  failBelow: 30,
  lockAbove: 50,
  clearRssi: 82,
  lowBatteryPct: 20,
  critBatteryPct: 10,
  receiver: 'solar-panel',
}