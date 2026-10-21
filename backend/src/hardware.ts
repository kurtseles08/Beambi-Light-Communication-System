import { randomUUID } from 'node:crypto'
import type { Channel, LinkEvent, LinkState, Mode, Reading, UnitId, UnitStatus } from './types.js'

export type UnitReport = {
  unit: UnitId
  rssi: number // relative envelope/threshold score, not calibrated optical power
  mode?: Mode
  laserOk?: boolean
  channel?: Channel
}
const STALE_MS = 5000
const MODE_LABEL = { auto: 'Auto', fso: 'Force laser', rf: 'Force LoRa' }
type Stored = { r: UnitReport; ts: number }

export function createHardware() {
  const last: Partial<Record<UnitId, Stored>> = {}
  const startTs = Date.now()
  let wasChannel: Channel | null = null
  let wasMode: Mode | null = null
  let failovers = 0
  let lastFailoverTs: number | null = null
  let lastFailoverReason: string | null = null

  function ingest(raw: UnitReport) {
    if (!Number.isFinite(raw.rssi)) return
    last[raw.unit] = { r: { ...raw, rssi: Math.min(100, Math.max(0, raw.rssi)) }, ts: Date.now() }
  }
  function step() {
    const ts = Date.now()
    const fresh = (x?: Stored) => x && ts - x.ts < STALE_MS ? x : undefined
    const A = fresh(last.A), B = fresh(last.B)
    const live = [A, B].filter((x): x is Stored => x !== undefined)
    if (!live.length) { wasChannel = wasMode = null; return null }
    const mode = live.find((x) => x.r.mode)?.r.mode ?? 'auto'
    const channel: Channel = live.some((x) => x.r.channel === 'RF') ? 'RF' : 'FSO'
    const allLaser = !!A && !!B && live.every((x) => x.r.laserOk === true)
    const state: LinkState = channel === 'RF' ? 'Failover' : allLaser ? 'Locked' : 'Searching'
    const events: LinkEvent[] = []
    const add = (severity: LinkEvent['severity'], type: string, message: string) =>
      events.push({ id: randomUUID(), ts, severity, type, message })
    if (wasMode !== null && wasMode !== mode) add('Info', 'mode', `Path mode set to ${MODE_LABEL[mode]}`)
    if (wasChannel === 'FSO' && channel === 'RF' && mode === 'auto') {
      failovers++
      lastFailoverTs = ts
      lastFailoverReason = 'Laser indication lost'
      add('Warning', 'failover', 'Laser indication lost; LoRa remains telemetry only')
    } else if (wasChannel === 'RF' && channel === 'FSO' && mode === 'auto') {
      add('Info', 'recovered', 'Laser indication restored')
    }
    wasChannel = channel; wasMode = mode
    const unit = (x?: Stored): UnitStatus => ({
      online: !!x, rssi: x?.r.rssi ?? 0, laser: x?.r.laserOk === true,
    })
    const reading: Reading = {
      // Re-evaluating the summary must not make old hardware data look fresh.
      ts: Math.max(...live.map((x) => x.ts)), mode, activeChannel: channel, linkState: state,
      fso: { rssi: Math.min(...live.map((x) => x.r.rssi)), laserOk: allLaser },
      units: { A: unit(A), B: unit(B) },
      session: { uptimeSec: Math.floor((ts - startTs) / 1000), failovers, lastFailoverTs, lastFailoverReason },
    }
    return { reading, events }
  }
  return { ingest, step }
}
