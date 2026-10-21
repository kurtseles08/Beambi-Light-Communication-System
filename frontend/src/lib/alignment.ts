import type { Reading, Settings } from '../types'
import { recentReadings } from './freshness'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function std(xs: number[]) {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

// Least-squares slope against report timestamps (signal points per second).
function slope(readings: Reading[]) {
  const ys = readings.map((r) => r.fso.rssi)
  const xs = readings.map((r) => (r.ts - readings[0].ts) / 1000)
  const n = ys.length
  if (n < 3) return 0
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  ys.forEach((y, i) => {
    num += (xs[i] - mx) * (y - my)
    den += (xs[i] - mx) ** 2
  })
  return den ? num / den : 0
}

export type Trend = 'rising' | 'steady' | 'falling'

export type Alignment = {
  rssi: number
  peak: number // best RSSI in the last 60 s
  avg: number
  min: number
  aboveLockPct: number // share of recent samples at/above the display threshold
  margin: number // points above (+) or below (-) the lock threshold
  zone: 'locked' | 'marginal' | 'fail'
  aligned: boolean
  trend: Trend // what the signal is doing right now
  slopePer10s: number
  drifting: boolean
  sudden: boolean // a sharp recent drop; physical cause is unknown
  sigma: number
  stability: 'Stable' | 'Fluctuating' | 'Unstable'
}

export function evaluateAlignment(readings: Reading[], s: Settings): Alignment | null {
  const last = readings.at(-1)
  if (!last) return null
  const rssi = last.fso.rssi
  const recent = recentReadings(readings, 60)
  const w60 = recent.map((r) => r.fso.rssi)
  const recent30 = recentReadings(recent, 30)
  const w30 = recent30.map((r) => r.fso.rssi)
  const sigma = std(recentReadings(recent, 10).map((r) => r.fso.rssi))
  const slopePer10s = slope(recent30) * 10
  const zone = rssi >= s.lockAbove ? 'locked' : rssi >= s.failBelow ? 'marginal' : 'fail'

  // Detect abrupt changes without assigning a physical cause.
  const hasStep = (xs: number[]) => xs.some((v, i) => i > 0 && xs[i - 1] - v >= 15)
  const stepIn30 = hasStep(w30)
  const sudden = hasStep(recentReadings(recent, 8).map((r) => r.fso.rssi))

  // Rising or falling right now: a clear jump over 3 s, or a steady slope over 6 s
  const before = recent.filter((r) => r.ts <= last.ts - 3000).at(-1)
  const jump = before && last.ts - before.ts < 5000 ? rssi - before.fso.rssi : 0
  const s6 = slope(recentReadings(recent, 6))
  const trend: Trend = jump >= 5 || s6 >= 0.8 ? 'rising' : jump <= -5 || s6 <= -0.8 ? 'falling' : 'steady'

  return {
    rssi,
    peak: Math.max(...w60),
    avg: mean(w60),
    min: Math.min(...w60),
    aboveLockPct: (w60.filter((v) => v >= s.lockAbove).length / w60.length) * 100,
    margin: rssi - s.lockAbove,
    zone,
    aligned: zone === 'locked',
    trend,
    slopePer10s,
    // A sustained downward trend in otherwise recent reports.
    drifting: w30.length >= 20 && slopePer10s <= -5 && rssi >= s.failBelow && !stepIn30,
    sudden,
    sigma,
    stability: sigma < 2.5 ? 'Stable' : sigma < 5 ? 'Fluctuating' : 'Unstable',
  }
}

export type Advice = { tone: 'default' | 'ok' | 'warn' | 'crit'; title: string; text: string }

// Signal trends guide manual adjustment; they cannot identify the physical cause.
export function coach(a: Alignment): Advice {
  if (a.rssi < 5) return { tone: 'warn', title: 'Very low signal', text: 'Check the beam path and watch the signal while adjusting the aim.' }
  if (a.sudden) return { tone: 'warn', title: 'Sudden signal drop', text: 'The received signal dropped sharply. Check the units and beam path.' }
  if (a.trend === 'rising') return { tone: 'ok', title: 'Signal rising', text: 'Continue small adjustments while watching the received signal.' }
  if (a.trend === 'falling') return { tone: 'warn', title: 'Signal falling', text: 'Pause and compare the current position with your last stronger reading.' }
  return { tone: a.zone === 'locked' ? 'ok' : 'default', title: 'Signal steady', text: 'Compare the current score with the recent peak. Listen at the receiver to verify audio quality.' }
}
