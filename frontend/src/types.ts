// Shared data model. Keep this file identical in backend/src and frontend/src.

export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Aligning' | 'Locked' | 'Degraded' | 'Failover' | 'Re-acquiring'
export type Severity = 'Info' | 'Warning' | 'Critical'
export type Mode = 'auto' | 'fso' | 'rf'
export type Receiver = 'solar-panel' | 'photodiode'

// What the demo buttons can trigger
export type Inject = 'clear' | 'fog' | 'dust' | 'obstruction' | 'glare' | 'lossburst' | 'drift' | 'tamper' | 'lowbattery'

export type Direction = {
  connected: boolean
  bitrateKbps: number
  latencyMs: number
  jitterMs: number
  packetLoss: number // %
  framesSent: number // cumulative this session
  framesReceived: number
  framesLost: number
  bytes: number
}

export type UnitStatus = {
  online: boolean
  battery: number // %
  voltage: number
  tamper: boolean
}

export type Reading = {
  ts: number
  mode: Mode
  activeChannel: Channel
  linkState: LinkState
  fso: {
    rssi: number // 0-100 received optical strength
    snr: number // dB
    berPre: number
    berPost: number
    frameLoss: number // %
    laserOk: boolean
    rxPresent: boolean
    ambientLux: number
  }
  rf: {
    rssi: number // dBm
    snr: number // dB
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
  security: {
    cipher: string
    fsoEncrypted: boolean
    rfEncrypted: boolean
    failedDecryptions: number
    framesAuthenticated: number
  }
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
  unit?: 'A' | 'B'
  durationSec?: number
}

export type PacketRecord = {
  id: string
  ts: number
  dir: 'A→B' | 'B→A'
  channel: Channel
  seq: number
  size: number
  crc: 'OK' | 'FEC corrected' | 'CRC fail' | '—'
  status: 'Delivered' | 'Corrected' | 'Lost'
}

export type Settings = {
  mode: Mode
  failBelow: number // switch to RF when RSSI stays below this
  lockAbove: number // "Locked" at or above this; also the recovery level
  failDelaySec: number
  recoverHoldSec: number
  maxFrameLoss: number // % frame loss that also triggers failover
  clearRssi: number // calibration: RSSI in clear air
  ambientWarnLux: number
  ambientCritLux: number
  lowBatteryPct: number
  critBatteryPct: number
  receiver: Receiver
  autoScenarios: boolean
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
