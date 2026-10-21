import type { Settings } from '../types'
// Envelope equals threshold at 50; firmware releases below 70% (about 42).
export const DEFAULT_SETTINGS: Settings = { failBelow: 42, lockAbove: 50 }
