export type Channel = 'FSO' | 'RF'
export type LinkState = 'Searching' | 'Aligning' | 'Locked' | 'Degraded' | 'Failover' | 'Re-acquiring'
export type Severity = 'Info' | 'Warning' | 'Critical'

export type Direction = {
  connected: boolean
  bitrateKbps: number
  latencyMs: number
  jitterMs: number
  packetLoss: number // %
}

export type UnitStatus = {
  online: boolean
  battery: number // %
  voltage: number
}

export type Reading = {
  ts: number
  activeChannel: Channel
  linkState: LinkState
  fso: {
    rssi: number // 0-100 signal strength (map from photodiode ADC later)
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
    channel: number // hop channel index
    hopSync: boolean
    retransmissions: number // cumulative
    codec: string
    encrypted: boolean
  }
  ab: Direction // Unit A -> Unit B
  ba: Direction // Unit B -> Unit A
  units: { A: UnitStatus; B: UnitStatus }
  session: {
    uptimeSec: number
    failovers: number
    lastFailoverTs: number | null
    lastFailoverReason: string | null
  }
}

export type LinkEvent = {
  id: number
  ts: number
  severity: Severity
  type: string
  message: string
}