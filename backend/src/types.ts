// Shared data model. Keep this file identical in backend/src and frontend/src.

export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Aligning' | 'Locked' | 'Degraded' | 'Failover' | 'Re-acquiring'
export type Severity = 'Info' | 'Warning' | 'Critical'
export type Mode = 'auto' | 'fso' | 'rf'
export type Receiver = 'solar-panel' | 'photodiode'

// What the demo buttons can trigger


export type UnitId = 'A' | 'B'

// A voice message that arrived intact enough to be accepted

// Sound that was NOT accepted as a message. It is counted but never shown as a message.


// Moves the simulated mount (Alignment practice). One step is a small mount adjustment.

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

export type Settings = {
  mode: Mode
  failBelow: number // switch to RF when RSSI stays below this
  lockAbove: number // "Locked" at or above this; also the recovery level
  failDelaySec: number
  recoverHoldSec: number
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
  t: 'status'
  unit: UnitId
  batV?: number         // battery volts, -1 when no battery is wired
  batPct?: number       // battery percent, -1 when unknown
  up: number            // firmware uptime, s
  laser: 0 | 1          // debounced laser link
  env: number           // receiver envelope 0..1
  thr: number           // link threshold
  mode: 0 | 1 | 2       // 0 AUTO, 1 force LASER, 2 force LORA
  failover: 0 | 1       // 1 = LoRa is the active path
  tx: number            // TX source 0..4
  rx: number            // RX sink 0..2
  vol: number
  rxGain: number
  micGain: number
  duck: 0 | 1
  gate: 0 | 1
  micP2P: number
  panP2P: number
  workAvg: number       // us
  workMax: number       // us
  over: number
  cal: 0 | 1            // calibrating now
  lora: {
    ok: 0 | 1
    peer: string        // '-' = nobody heard yet
    peerLaser: 0 | 1
    ageS: number        // seconds since peer heard, -1 = never
    rssi: number
    snr: number
    tx: number
    rx: number
  }
  ts?: number           // added by backend
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