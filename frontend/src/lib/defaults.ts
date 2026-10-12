import type { Settings } from '../types'

// Mirrors backend/src/settings.ts. The backend sends the real values when the page connects.
export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  failBelow: 30,
  lockAbove: 50,
  failDelaySec: 2,
  recoverHoldSec: 5,
  maxFrameLoss: 25,
  clearRssi: 82,
  ambientWarnLux: 20000,
  ambientCritLux: 50000,
  lowBatteryPct: 20,
  critBatteryPct: 10,
  receiver: 'solar-panel',
  autoScenarios: true,
}
