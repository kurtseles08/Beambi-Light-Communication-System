import { randomUUID } from 'node:crypto'
import type {
  Channel, Direction, FilteredEvent, LinkEvent, LinkState, MessageRecord, PacketRecord,
  Reading, Settings, Severity, UnitId, UnitStatus,
} from './types.js'

// What one ESP32 sends each second. Only unit and rssi are required.
export type UnitReport = {
  unit: UnitId
  rssi: number // 0-100 optical strength seen by THIS unit's receiver
  snr?: number
  berPre?: number
  berPost?: number
  lossPct?: number // frame loss % seen by this unit
  laserOk?: boolean
  lux?: number
  channel?: Channel // channel this unit is currently using
  rfRssi?: number // dBm
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
  txFrames?: number // cumulative frames this unit sent
  rxFrames?: number // cumulative frames this unit received
  rxLost?: number
  rxBytes?: number
  latencyMs?: number
  jitterMs?: number
  bitrateKbps?: number
}

const STALE_MS = 5000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

type Stored = { r: UnitReport; ts: number }

export function createHardware(getSettings: () => Settings) {
  const last: Partial<Record<UnitId, Stored>> = {}
  const startTs = Date.now()
  let wasChannel: Channel | null = null
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
    if (live.length === 0) return null

    const vals = (f: (r: UnitReport) => unknown) =>
      live.map((x) => num(f(x.r))).filter((v): v is number => v !== undefined)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

    // The link is only as good as its weaker receiver
    const rssi = Math.min(...vals((r) => r.rssi))
    const reportedRf = live.some((x) => x.r.channel === 'RF')
    const channel: Channel = s.mode === 'rf' ? 'RF' : s.mode === 'fso' ? 'FSO' : reportedRf ? 'RF' : 'FSO'
    const state: LinkState =
      channel === 'RF' ? 'Failover' : rssi >= s.lockAbove ? 'Locked' : rssi >= s.failBelow ? 'Degraded' : 'Searching'

    const events: LinkEvent[] = []
    const addEvent = (severity: Severity, type: string, message: string, extra: Partial<LinkEvent> = {}) =>
      events.push({ id: randomUUID(), ts, severity, type, message, ...extra })

    if (wasChannel === 'FSO' && channel === 'RF') {
      failovers++
      lastFailoverTs = ts
      lastFailoverReason = rssi < s.failBelow ? 'Low optical signal' : 'Radio fallback'
      addEvent('Warning', 'failover', `Failover to RF: ${lastFailoverReason}`)
    } else if (wasChannel === 'RF' && channel === 'FSO') {
      addEvent('Info', 'recovered', 'FSO restored, back on the optical link')
    }
    wasChannel = channel
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
        connected: to !== undefined && (channel === 'FSO' ? to.r.rssi >= 20 : rf > -115),
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
      battery: num(x?.r.battery) ?? 0,
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
      mode: s.mode,
      activeChannel: channel,
      linkState: state,
      fso: {
        rssi, snr: avg(vals((r) => r.snr)), berPre, berPost,
        frameLoss: avg(vals((r) => r.lossPct)),
        laserOk: live.every((x) => x.r.laserOk !== false),
        rxPresent: rssi > 5,
        ambientLux: Math.max(0, ...vals((r) => r.lux)),
      },
      rf: {
        rssi: rfVals.length ? avg(rfVals) : -120,
        snr: avg(vals((r) => r.rfSnr)),
        channel: Math.round(vals((r) => r.rfChannel)[0] ?? 0),
        hopSync: live.every((x) => x.r.hopSync !== false),
        retransmissions: Math.max(0, ...vals((r) => r.retransmissions)),
        codec: channel === 'FSO' ? 'PCM 64 kbps' : 'ADPCM 12 kbps', // assumption: match your firmware
        encrypted,
      },
      ab: dir(A, B),
      ba: dir(B, A),
      units: { A: unit(A), B: unit(B) },
      env: { temperatureC: avg(vals((r) => r.tempC)), humidityPct: avg(vals((r) => r.humidityPct)) },
      // no `aim`: real hardware can't know the offset, so the frontend hides that panel
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