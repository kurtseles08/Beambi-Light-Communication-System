// Shared data model. Keep this file identical in backend/src and frontend/src.

export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Aligning' | 'Locked' | 'Degraded' | 'Failover' | 'Re-acquiring'
export type Severity = 'Info' | 'Warning' | 'Critical'
export type Mode = 'auto' | 'fso' | 'rf'
export type Receiver = 'solar-panel' | 'photodiode'
export type UnitId = 'A' | 'B'

export type Direction = {
  connected: boolean
  bitrateKbps: number
  latencyMs: number
  jitterMs: number
  packetLoss: number // %
  framesSent: number
  framesReceived: number
  framesLost: number
  bytes: number
}

export type UnitStatus = {
  online: boolean
  battery: number // %
  voltage: number
  tamper: boolean
  rssi: number // this unit's own receiver, 0-100
  laser: boolean // this unit's debounced laser flag
}

export type Reading = {
  ts: number
  mode: Mode
  activeChannel: Channel
  linkState: LinkState
  fso: {
    rssi: number // 0-100, derived from receiver envelope vs threshold
    snr: number
    berPre: number
    berPost: number
    frameLoss: number
    laserOk: boolean
    rxPresent: boolean
    ambientLux: number
  }
  rf: {
    rssi: number // dBm
    snr: number
    channel: number
    hopSync: boolean
    retransmissions: number
    codec: string
    encrypted: boolean
  }
  ab: Direction // Unit A -> Unit B
  ba: Direction // Unit B -> Unit A
  units: { A: UnitStatus; B: UnitStatus }
  env: { temperatureC: number; humidityPct: number }
  session: {
    uptimeSec: number
    failovers: number
    lastFailoverTs: number | null
    lastFailoverReason: string | null
  }
}

export type LinkEvent = {
  id: string
  ts: number
  severity: Severity
  type: string
  message: string
  unit?: UnitId
  durationSec?: number
}

export type Settings = {
  mode: Mode
  failBelow: number // dashboard zone: red below this
  lockAbove: number // dashboard zone: Locked at or above this
  clearRssi: number // calibration: RSSI in clear air
  lowBatteryPct: number
  critBatteryPct: number
  receiver: Receiver
}

// One history point every 5 s
export type Sample = {
  ts: number
  ch: Channel
  state: LinkState
  rssi: number
  snr: number
  berPre: number
  berPost: number
  latencyMs: number
  bitrateKbps: number
  loss: number
  lux: number
  tempC: number
  hum: number
  batA: number
  batB: number
}

export type Run = {
  id: string
  startedAt: number
  endedAt: number | null
  distanceM: number
  notes: string
  samples: number
  avgRssi: number
  minRssi: number
  maxRssi: number
  avgSnr: number
  pdr: number // %
  failovers: number
  lockedPct: number
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
  wifi?: number
  t: 'status'
  unit: UnitId
  batV?: number // volts, -1 when no battery is wired
  batPct?: number // percent, -1 when unknown
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

export type LoraMessage = { id: string; ts: number; from: string; rssi: number; snr: number; text: string }
export type PongRecord = { id: string; ts: number; from: string; seq: string; rssi: number; snr: number }

export type DeviceCommand =
  | { cmd: 'set'; k: 'txSrc' | 'rxSink' | 'vol' | 'rxGain' | 'micGain' | 'duck' | 'gate' | 'linkThresh' | 'rxGate' | 'rxNoiseFloor'; v: number }
  | { cmd: 'mode'; v: 0 | 1 | 2 }
  | { cmd: 'cal' }
  | { cmd: 'ping' }
  | { cmd: 'msg'; text: string }
