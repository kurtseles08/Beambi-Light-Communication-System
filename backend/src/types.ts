// Canonical dashboard API contract. The frontend re-exports these types.
export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Locked' | 'Failover'
export type Severity = 'Info' | 'Warning' | 'Critical'
export type Mode = 'auto' | 'fso' | 'rf'
export type UnitId = 'A' | 'B'
export type UnitStatus = { online: boolean; rssi: number; laser: boolean }
export type Reading = {
  ts: number
  mode: Mode
  activeChannel: Channel
  linkState: LinkState
  fso: { rssi: number; laserOk: boolean }
  units: Record<UnitId, UnitStatus>
  session: {
    uptimeSec: number // backend session duration, not device uptime
    failovers: number
    lastFailoverTs: number | null
    lastFailoverReason: string | null
  }
}
export type LinkEvent = {
  id: string; ts: number; severity: Severity; type: string; message: string
  unit?: UnitId; durationSec?: number
}
// Display preferences belong to this browser; firmware controls live on Hardware.
export type Settings = { failBelow: number; lockAbove: number }
export type Sample = { ts: number; ch: Channel; state: LinkState; rssi: number }
export type Run = {
  id: string; startedAt: number; endedAt: number | null
  distanceM: number // manually entered test distance
  notes: string; samples: number; avgRssi: number; minRssi: number; maxRssi: number
  failovers: number; lockedPct: number
}

// ---- Firmware (ESP32) interface ----
export type DeviceStatus = {
  fs?: number
  audioV?: number
  rxGate?: number
  rxNoiseFloor?: number
  transport?: string
  adcErrors?: number
  micMin?: number
  micMax?: number
  panMin?: number
  panMax?: number
  savedMicGain?: number
  micSamples?: number
  micRailSamples?: number
  txClipSamples?: number
  wifi?: number
  t: 'status'
  unit: UnitId
  up: number // firmware uptime, s
  laser: 0 | 1
  env: number // receiver envelope 0..1
  thr: number // link threshold
  mode: 0 | 1 | 2 // 0 auto, 1 force laser, 2 force LoRa
  failover: 0 | 1 // 1 = LoRa is the active path
  tx: number
  rx: number
  vol: number
  rxGain: number
  micGain: number
  duck: 0 | 1
  gate: 0 | 1
  micP2P: number
  panP2P: number
  workAvg: number // us
  workMax: number // us
  over: number
  cal: 0 | 1
  lora: {
    ok: 0 | 1
    enabled?: 0 | 1
    peer: string // '-' = nobody heard yet
    peerLaser: 0 | 1
    ageS: number // -1 = never
    rssi: number
    snr: number
    tx: number
    rx: number
  }
  ts?: number // added by backend
}

export type DeviceCommand =
  | { cmd: 'set'; k: 'txSrc' | 'rxSink' | 'vol' | 'rxGain' | 'micGain' | 'duck' | 'gate' | 'linkThresh' | 'rxGate' | 'rxNoiseFloor'; v: number }
  | { cmd: 'mode'; v: 0 | 1 | 2 }
  | { cmd: 'cal' }
