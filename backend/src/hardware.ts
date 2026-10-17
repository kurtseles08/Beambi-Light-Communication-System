import { randomUUID } from 'node:crypto'
import type {
  Channel, Direction, FilteredEvent, LinkEvent, LinkState, MessageRecord, Mode, PacketRecord,
  Reading, Settings, Severity, UnitId, UnitStatus,
} from './types.js'

// What one ESP32 sends each second. Only unit and rssi are required.
export type UnitReport = {
  unit: UnitId
  rssi: number // 0-100 optical strength seen by THIS unit's receiver (derived from env/thr, see index.ts)
  mode?: Mode // path mode set ON THE DEVICE (the firmware owns it)
  snr?: number
  berPre?: number
  berPost?: number
  lossPct?: number
  laserOk?: boolean // firmware's debounced laser flag
  lux?: number
  channel?: Channel // channel this unit is using now (firmware's failover flag)
  rfRssi?: number // dBm, leave undefined when no peer has been heard
  rfSnr?: number
  rfChannel?: number
  hopSync?: boolean
  retransmissions?: number
  encrypted?: boolean
  cipher?: string
  failedDecryptions?: number
  battery?: number
  voltage?: number
  tamper?: boolean
  tempC?: number
  humidityPct?: number
  txFrames?: number
  rxFrames?: number
  rxLost?: number
  rxBytes?: number
  latencyMs?: number
  jitterMs?: number
  bitrateKbps?: number
}

const STALE_MS = 5000
const MODE_LABEL: Record<Mode, string> = { auto: 'Auto', fso: 'Force laser', rf: 'Force LoRa' }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

type Stored = { r: UnitReport; ts: number }

export function createHardware(getSettings: () => Settings) {
  const last: Partial<Record<UnitId, Stored>> = {}
  const startTs = Date.now()
  let wasChannel: Channel | null = null
  let wasMode: Mode | null = null
  const wasTamper: Record<UnitId, boolean> = { A: false, B: false }
  let failovers = 0
  let lastFailoverTs: number | null = null
  let lastFailoverReason: string | null = null

  function ingest(raw: UnitReport) {
    last[raw.unit] = { r: { ...raw, rssi: clamp(raw.rssi, 0, 100) }, ts: Date.now() }
  }

  // Returns null when no unit has reported recently, so the dashboard goes Offline by itself
  function step() {
    const ts = Date.now()
    const s = getSettings()
    const fresh = (x?: Stored) => (x && ts - x.ts <= STALE_MS ? x : undefined)
    const A = fresh(last.A)
    const B = fresh(last.B)
    const live = [A, B].filter((x): x is Stored => x !== undefined)
    if (live.length === 0) {
      // forget history so a reconnect does not raise a false failover or mode event
      wasChannel = null
      wasMode = null
      return null
    }

    const vals = (f: (r: UnitReport) => unknown) =>
      live.map((x) => num(f(x.r))).filter((v): v is number => v !== undefined)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

    // The link is only as good as its weaker receiver
    const rssi = Math.min(...vals((r) => r.rssi))

    // The firmware owns mode, channel and the laser flag. The dashboard only mirrors them.
    const devMode: Mode = live.find((x) => x.r.mode)?.r.mode ?? s.mode
    const channel: Channel = live.some((x) => x.r.channel === 'RF') ? 'RF' : 'FSO'
    const anyLaser = live.some((x) => x.r.laserOk === true)
    const state: LinkState = channel === 'RF' ? 'Failover' : anyLaser ? 'Locked' : 'Searching'

    const events: LinkEvent[] = []
    const addEvent = (severity: Severity, type: string, message: string, extra: Partial<LinkEvent> = {}) =>
      events.push({ id: randomUUID(), ts, severity, type, message, ...extra })

    if (wasMode !== null && wasMode !== devMode) {
      addEvent('Info', 'mode', `Path mode set to ${MODE_LABEL[devMode]}`)
    }
    // Only an automatic switch counts as a failover. Forcing LoRa by hand is not one.
    if (wasChannel === 'FSO' && channel === 'RF' && devMode === 'auto') {
      failovers++
      lastFailoverTs = ts
      lastFailoverReason = 'Laser link lost'
      addEvent('Warning', 'failover', `Failover to LoRa: ${lastFailoverReason}`)
    } else if (wasChannel === 'RF' && channel === 'FSO' && devMode === 'auto') {
      addEvent('Info', 'recovered', 'Laser restored, back on the optical link')
    }
    wasChannel = channel
    wasMode = devMode

    for (const x of live) {
      const t = x.r.tamper === true
      if (t && !wasTamper[x.r.unit]) {
        addEvent('Critical', 'tamper', `Tamper detected on Unit ${x.r.unit}: enclosure opened`, { unit: x.r.unit })
      }
      wasTamper[x.r.unit] = t
    }

    // A -> B is what B received of what A sent
    const dir = (from?: Stored, to?: Stored): Direction => {
      const sent = num(from?.r.txFrames) ?? 0
      const recv = num(to?.r.rxFrames) ?? 0
      const rf = num(to?.r.rfRssi) ?? -120
      return {
        connected: to !== undefined && (channel === 'FSO' ? to.r.laserOk === true : rf > -115),
        bitrateKbps: num(to?.r.bitrateKbps) ?? 0,
        latencyMs: Math.round(num(to?.r.latencyMs) ?? 0),
        jitterMs: num(to?.r.jitterMs) ?? 0,
        packetLoss: num(to?.r.lossPct) ?? 0,
        framesSent: sent,
        framesReceived: recv,
        framesLost: num(to?.r.rxLost) ?? Math.max(0, sent - recv),
        bytes: num(to?.r.rxBytes) ?? 0,
      }
    }
    const unit = (x?: Stored): UnitStatus => ({
      online: x !== undefined,
      battery: num(x?.r.battery) ?? 0, // 0 means "not reported" until the firmware sends it
      voltage: num(x?.r.voltage) ?? 0,
      tamper: x?.r.tamper === true,
    })

    const rfVals = vals((r) => r.rfRssi)
    const encrypted = live.every((x) => x.r.encrypted === true)
    const cipher = live.find((x) => x.r.cipher)?.r.cipher ?? 'None'
    const berPre = avg(vals((r) => r.berPre))
    const berPost = avg(vals((r) => r.berPost))

    const reading: Reading = {
      ts,
      mode: devMode,
      activeChannel: channel,
      linkState: state,
      fso: {
        rssi, snr: avg(vals((r) => r.snr)), berPre, berPost,
        frameLoss: avg(vals((r) => r.lossPct)),
        laserOk: anyLaser,
        rxPresent: anyLaser,
        ambientLux: Math.max(0, ...vals((r) => r.lux)),
      },
      rf: {
        rssi: rfVals.length ? avg(rfVals) : -120,
        snr: avg(vals((r) => r.rfSnr)),
        channel: Math.round(vals((r) => r.rfChannel)[0] ?? 0),
        hopSync: live.every((x) => x.r.hopSync !== false),
        retransmissions: Math.max(0, ...vals((r) => r.retransmissions)),
        codec: channel === 'FSO' ? 'Laser audio' : 'LoRa', // label only, adjust to your firmware
        encrypted,
      },
      ab: dir(A, B),
      ba: dir(B, A),
      units: { A: unit(A), B: unit(B) },
      env: { temperatureC: avg(vals((r) => r.tempC)), humidityPct: avg(vals((r) => r.humidityPct)) },
      // no `aim`: real hardware cannot know the offset, so the frontend hides that panel
      security: {
        cipher, fsoEncrypted: encrypted, rfEncrypted: encrypted,
        failedDecryptions: vals((r) => r.failedDecryptions).reduce((a, b) => a + b, 0),
        framesAuthenticated: vals((r) => r.rxFrames).reduce((a, b) => a + b, 0),
      },
      session: { uptimeSec: Math.floor((ts - startTs) / 1000), failovers, lastFailoverTs, lastFailoverReason },
    }
    return {
      reading, events, scenario: 'clear',
      packets: [] as PacketRecord[], messages: [] as MessageRecord[], filtered: [] as FilteredEvent[],
    }
  }

  return { step, ingest }
}