import type { Reading } from '../types'

// Interference indicators worked out from fields every Reading already has.
// RF noise floor = RSSI minus SNR, so real LoRa telemetry gives the same numbers.

// Typical noise floor of a quiet channel. Calibrate this after field tests with the real radio.
export const NOISE_REF_DBM = -95
const WARN_RISE_DB = 8
const CRIT_RISE_DB = 15
const LOSS_WARN_PCT = 10
export const HOP_CHANNELS = 8 // simulator hop table. Change when the firmware defines the real one.

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const floorOf = (r: Reading) => r.rf.rssi - r.rf.snr

export type Verdict = 'clear' | 'possible' | 'suspected'

export type ChannelNoise = { channel: number; samples: number; riseDb: number | null }

export type Jamming = {
  verdict: Verdict
  noiseFloorDbm: number
  riseDb: number // dB above the normal noise floor
  noiseLevel: 'ok' | 'warn' | 'crit'
  syncLosses: number // times hop sync was lost in the last 30 s
  syncBad: boolean
  rfLossPct: number | null // null while traffic is on FSO, so the RF path is idle
  lossBad: boolean
  channels: ChannelNoise[]
  worst: ChannelNoise | null
}

export function evaluateJamming(readings: Reading[]): Jamming | null {
  const last = readings.at(-1)
  if (!last) return null

  const noiseFloorDbm = mean(readings.slice(-5).map(floorOf))
  const riseDb = noiseFloorDbm - NOISE_REF_DBM
  const noiseLevel = riseDb >= CRIT_RISE_DB ? 'crit' : riseDb >= WARN_RISE_DB ? 'warn' : 'ok'

  const syncLosses = readings.slice(-30).filter((r) => !r.rf.hopSync).length
  const syncBad = syncLosses >= 3

  const onRf = last.activeChannel === 'RF'
  const rfLossPct = onRf ? mean(readings.slice(-10).map((r) => Math.max(r.ab.packetLoss, r.ba.packetLoss))) : null
  const lossBad = rfLossPct !== null && rfLossPct >= LOSS_WARN_PCT

  // Average noise floor on each hop channel over the last 2 minutes
  const window = readings.slice(-120)
  const channels: ChannelNoise[] = Array.from({ length: HOP_CHANNELS }, (_, c) => {
    const xs = window.filter((r) => r.rf.channel === c).map(floorOf)
    return { channel: c, samples: xs.length, riseDb: xs.length ? mean(xs) - NOISE_REF_DBM : null }
  })
  const seen = channels.filter((c) => c.riseDb !== null && c.samples >= 3)
  const worst = seen.length ? seen.reduce((a, b) => ((b.riseDb ?? -99) > (a.riseDb ?? -99) ? b : a)) : null

  const score = (noiseLevel === 'crit' ? 2 : noiseLevel === 'warn' ? 1 : 0) + (syncBad ? 1 : 0) + (lossBad ? 1 : 0)
  const verdict: Verdict = score >= 2 ? 'suspected' : score === 1 ? 'possible' : 'clear'

  return { verdict, noiseFloorDbm, riseDb, noiseLevel, syncLosses, syncBad, rfLossPct, lossBad, channels, worst }
}

// New failed decryptions in each of the last `n` seconds
export function failuresPerSecond(readings: Reading[], n = 60) {
  const w = readings.slice(-(n + 1))
  return w.slice(1).map((r, i) => ({ t: i - (w.length - 2), n: Math.max(0, r.security.failedDecryptions - w[i].security.failedDecryptions) }))
}

export type Interruption = { id: string; start: number; durationSec: number | null } // null while still blocked

// Pairs each "beam interrupted" event with the "beam restored" event that follows it
export function interruptions(events: { id: string; ts: number; type: string; durationSec?: number }[]): Interruption[] {
  const out: Interruption[] = []
  let open: Interruption | null = null
  for (const e of events) {
    if (e.type === 'beam-interruption') {
      open = { id: e.id, start: e.ts, durationSec: null }
      out.push(open)
    } else if (e.type === 'beam-restored' && open) {
      open.durationSec = e.durationSec ?? Math.round((e.ts - open.start) / 1000)
      open = null
    }
  }
  return out
}