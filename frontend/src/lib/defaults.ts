import type { Settings } from '../types'

// Mirrors backend/src/settings.ts. The backend sends the real values when the page connects.
// failBelow and lockAbove are kept in the browser, so they always win over the backend.
export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  failBelow: 5,
  lockAbove: 8,
  clearRssi: 82,
  lowBatteryPct: 20,
  critBatteryPct: 10,
  receiver: 'solar-panel',
}