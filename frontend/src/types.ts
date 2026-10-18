// Shared data model. Keep this file identical in backend/src and frontend/src.

export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Aligning' | 'Locked' | 'Degraded' | 'Failover' | 'Re-acquiring'
export type Severity = 'Info' | 'Warning' | 'Critical'
export type Mode = 'auto' | 'fso' | 'rf'
export type Receiver = 'solar-panel' | 'photodiode'

// What the demo buttons can trigger
export type Inject =
  | 'clear' | 'fog' | 'dust' | 'obstruction' | 'glare' | 'lossburst' | 'drift' | 'tamper' | 'lowbattery'
  | 'message' | 'noise' | 'stutter'

export type UnitId = 'A' | 'B'

// A voice message that arrived intact enough to be accepted
export type MessageRecord = {
  id: string
  seq: number // message number
  ts: number // when it finished arriving
  from: UnitId
  to: UnitId // the unit that received it
  channel: Channel
  durationSec: number
  text: string // what the receiver understood. ··· marks a part that did not arrive.
  accuracy: number // % of the message's frames that arrived intact after error correction
  frames: number
  repaired: number // frames fixed by error correction
  lost: number
  rssi: number // average signal strength while it arrived
  snr: number
  latencyMs: number
  cipher: string // every accepted message passed the encryption check
}

// Sound that was NOT accepted as a message. It is counted but never shown as a message.
export type FilteredEvent = {
  id: string
  ts: number
  to: UnitId
  kind: 'stutter' | 'ambient' // stutter: too many frames failed the check. ambient: background sound with no valid frames.
  detail: string
}

export type UnitTotals = { received: number; accuracySum: number; stutter: number; ambient: number }

// Moves the simulated mount (Alignment practice). One step is a small mount adjustment.
export type AimCommand = { dPan?: number; dTilt?: number; reset?: boolean; bump?: boolean }

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
  // How far the beam is off the receiver, in steps. Simulator only: real hardware cannot know this
  // unless a gimbal or orientation sensor is added, so the screen hides it when this is missing.
  aim?: { pan: number; tilt: number }
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

// ---- Firmware (ESP32) interface ----
export type DeviceStatus = {
  t: 'status'
  unit: UnitId
  up: number
  laser: 0 | 1
  env: number
  thr: number
  mode: 0 | 1 | 2
  failover: 0 | 1
  tx: number
  rx: number
  vol: number
  rxGain: number
  micGain: number
  duck: 0 | 1
  gate: 0 | 1
  micP2P: number
  panP2P: number
  workAvg: number
  workMax: number
  over: number
  cal: 0 | 1
  batV?: number
  batPct?: number
  lora: {
    ok: 0 | 1
    peer: string
    peerLaser: 0 | 1
    ageS: number
    rssi: number
    snr: number
    tx: number
    rx: number
  }
  ts?: number
}

export type LoraMessage = { id: string; ts: number; from: string; rssi: number; snr: number; text: string }
export type PongRecord = { id: string; ts: number; from: string; seq: string; rssi: number; snr: number }

export type DeviceCommand =
  | { cmd: 'set'; k: 'txSrc' | 'rxSink' | 'vol' | 'rxGain' | 'micGain' | 'duck' | 'gate'; v: number }
  | { cmd: 'mode'; v: 0 | 1 | 2 }
  | { cmd: 'cal' }
  | { cmd: 'ping' }
  | { cmd: 'msg'; text: string }


  // A spoken message: what Unit X sent, and what the other unit's receiver actually got
export type VoiceRecord = {
  id: string
  seq: number
  ts: number
  from: UnitId // transmitter
  to: UnitId // receiver
  sent: string // full text at the transmitter
  received: string // text at the receiver. ··· marks words that did not arrive
  durationSec: number
  accuracy: number // % of the message time the receiver had the laser
  samples: number // receiver reports used
  signal: number | null // average receiver signal 0-100
  source: 'speech' | 'typed'
}