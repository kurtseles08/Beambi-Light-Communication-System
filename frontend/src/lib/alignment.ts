import type { Reading, Settings } from '../types'

// Same value as the simulator. One step is a small mount adjustment.

// How many steps off target the signal falls to a given level (used to draw the target rings)

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function std(xs: number[]) {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

// Least-squares slope for values sampled once per second (units per second)
function slope(ys: number[]) {
  const n = ys.length
  if (n < 3) return 0
  const mx = (n - 1) / 2
  const my = mean(ys)
  let num = 0
  let den = 0
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my)
    den += (i - mx) ** 2
  })
  return den ? num / den : 0
}

export type Trend = 'rising' | 'steady' | 'falling'

export type Alignment = {
  rssi: number
  peak: number // best RSSI in the last 60 s
  avg: number
  min: number
  aboveLockPct: number // share of the last 60 s spent at or above the lock level
  margin: number // points above (+) or below (-) the lock threshold
  zone: 'locked' | 'marginal' | 'fail'
  aligned: boolean
  trend: Trend // what the signal is doing right now
  slopePer10s: number
  drifting: boolean
  sudden: boolean // a sharp drop in the last few seconds (a knock or a blocked beam)
  sigma: number
  stability: 'Stable' | 'Fluctuating' | 'Unstable'
}

export function evaluateAlignment(readings: Reading[], s: Settings): Alignment | null {
  const last = readings.at(-1)
  if (!last) return null
  const rssi = last.fso.rssi
  const w60 = readings.slice(-60).map((r) => r.fso.rssi)
  const w30 = w60.slice(-30)
  const sigma = std(w60.slice(-10))
  const slopePer10s = slope(w30) * 10
  const zone = rssi >= s.lockAbove ? 'locked' : rssi >= s.failBelow ? 'marginal' : 'fail'

  // A sharp step down (15+ points in one second) is a knock or a blocked beam, not a slow drift
  const hasStep = (xs: number[]) => xs.some((v, i) => i > 0 && xs[i - 1] - v >= 15)
  const stepIn30 = hasStep(w30)
  const sudden = hasStep(w60.slice(-8))

  // Rising or falling right now: a clear jump over 3 s, or a steady slope over 6 s
  const jump = readings.length >= 4 ? rssi - readings[readings.length - 4].fso.rssi : 0
  const s6 = slope(w60.slice(-6))
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
    // A steady fall of 5+ points per 10 s while the link is still up points to a slipping mount
    drifting: w30.length >= 20 && slopePer10s <= -5 && rssi >= s.failBelow && !stepIn30,
    sudden,
    sigma,
    stability: sigma < 2.5 ? 'Stable' : sigma < 5 ? 'Fluctuating' : 'Unstable',
  }
}

export type Advice = { tone: 'default' | 'ok' | 'warn' | 'crit'; title: string; text: string }

// Plain instruction for the person aiming the laser. Uses only the signal, so it works with real hardware too.
export function coach(a: Alignment): Advice {
  if (a.rssi < 5)
    return { tone: 'crit', title: 'No light found', text: 'Nothing is reaching the receiver. Move the aim in small steps until the bar starts to rise.' }
  if (a.sudden && a.zone !== 'locked')
    return { tone: 'warn', title: 'Sudden drop', text: 'The signal fell all at once. The mount was probably knocked, or the beam was blocked. Check the beam path, then re-aim.' }
  if (a.drifting)
    return { tone: 'warn', title: 'Signal is drifting', text: 'The mount is slipping, probably from wind or vibration. Re-aim, then tighten the mount.' }
  if (a.zone === 'locked' && a.trend === 'steady' && a.rssi >= a.peak - 3)
    return { tone: 'ok', title: 'On target', text: 'You are at the best point. Hold still and tighten the mount.' }
  if (a.zone === 'locked' && a.trend === 'falling' && a.rssi < a.peak - 3)
    return { tone: 'warn', title: 'Past the best point', text: 'Go back a little, in the direction you came from.' }
  if (a.trend === 'rising')
    return { tone: 'ok', title: 'Getting better', text: 'Keep moving the same way until the signal stops rising.' }
  if (a.trend === 'falling')
    return { tone: a.zone === 'fail' ? 'crit' : 'warn', title: 'Getting worse', text: 'Reverse direction and use smaller steps.' }
  if (a.zone === 'locked')
    return {
      tone: 'ok',
      title: 'Locked',
      text: a.rssi < a.peak - 15
        ? `The best reading in the last minute was ${a.peak.toFixed(0)}. Try small moves to find it again.`
        : 'Signal is above the lock level. Fine-tune for the highest reading.',
    }
  if (a.zone === 'marginal')
    return { tone: 'warn', title: 'Close, not locked yet', text: `Raise the signal by ${(-a.margin).toFixed(0)} more points to reach the lock level. Make small moves and watch the bar.` }
  return { tone: 'crit', title: 'Below the failover level', text: 'The link would switch to the radio. Move in small steps and watch whether the bar rises or falls.' }
}
