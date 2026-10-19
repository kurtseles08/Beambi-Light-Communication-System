import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from './types.js'

export const DEFAULT_SETTINGS: Settings = {
  mode: 'auto',
  failBelow: 30,
  lockAbove: 50,
  failDelaySec: 2,
  recoverHoldSec: 5,
  clearRssi: 82,
  lowBatteryPct: 20,
  critBatteryPct: 10,
  receiver: 'solar-panel',
}

const FILE = path.resolve(process.cwd(), 'data', 'settings.json')

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

// Clamp every value and keep thresholds in a sensible order
 export function sanitize(patch: Partial<Settings>, base: Settings): Settings {
  const m = { ...base, ...patch }
  const s: Settings = {
    mode: m.mode === 'fso' || m.mode === 'rf' ? m.mode : 'auto',
    failBelow: num(m.failBelow, 5, 80, base.failBelow),
    lockAbove: num(m.lockAbove, 10, 95, base.lockAbove),
    failDelaySec: Math.round(num(m.failDelaySec, 1, 30, base.failDelaySec)),
    recoverHoldSec: Math.round(num(m.recoverHoldSec, 1, 60, base.recoverHoldSec)),
    clearRssi: num(m.clearRssi, 40, 100, base.clearRssi),
    lowBatteryPct: num(m.lowBatteryPct, 5, 60, base.lowBatteryPct),
    critBatteryPct: num(m.critBatteryPct, 2, 40, base.critBatteryPct),
    receiver: m.receiver === 'photodiode' ? 'photodiode' : 'solar-panel',
  }
  if (s.lockAbove < s.failBelow + 5) s.lockAbove = Math.min(95, s.failBelow + 5)
  if (s.critBatteryPct >= s.lowBatteryPct) s.critBatteryPct = Math.max(2, s.lowBatteryPct - 1)
  return s
}

export function loadSettings(): Settings {
  try {
    return sanitize(JSON.parse(fs.readFileSync(FILE, 'utf8')), DEFAULT_SETTINGS)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

// Debounced so dragging a slider does not hammer the disk
export function saveSettings(s: Settings) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(s, null, 2))
    } catch (e) {
      console.error('Could not save settings:', e)
    }
  }, 500)
}
