import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { createSimulator } from './simulator.js'
import { createStore } from './store.js'
import { loadSettings, sanitize, saveSettings } from './settings.js'
import type {
  AimCommand, DeviceCommand, DeviceStatus, FilteredEvent, LinkEvent, LoraMessage, MessageRecord,
  PacketRecord, PongRecord, Reading, Settings, UnitId, UnitTotals,
} from './types.js'
import { createHardware, type UnitReport } from './hardware.js'
import { createSerialBridge, type DeviceBridge } from './serial.js'
  import { createMockDevice } from './mock.js'

const TICK_MS = 1000
const MAX_READINGS = 120
const MAX_PACKETS = 200
const MAX_MESSAGES = 200
const MAX_LORA_LOG = 100
const ORIGINS = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173']
const COMMAND_TOKEN = process.env.COMMAND_TOKEN || ''

let settings: Settings = loadSettings()
const store = await createStore()

const SOURCE: 'simulator' | 'hardware' = process.env.DATA_SOURCE === 'hardware' ? 'hardware' : 'simulator'
const hw = createHardware(() => settings)
const MODES = ['auto', 'fso', 'rf'] as const // firmware mode 0, 1, 2

if (SOURCE === 'hardware' && !COMMAND_TOKEN) {
  console.warn('COMMAND_TOKEN is not set: anyone who can reach this server can command the hardware')
}

const app = express()
app.use(cors({ origin: ORIGINS }))
app.use(express.json())

// Optional HTTP ingest for Wi-Fi units. Disabled unless DEVICE_KEY is set, so it is never open by accident.
app.post('/api/telemetry', (req, res) => {
  const key = process.env.DEVICE_KEY
  if (!key) {
    res.status(403).json({ error: 'telemetry endpoint disabled (set DEVICE_KEY to enable)' })
    return
  }
  if (req.get('x-api-key') !== key) {
    res.status(401).json({ error: 'bad key' })
    return
  }
  const b = req.body as Partial<UnitReport> | undefined
  if (!b || (b.unit !== 'A' && b.unit !== 'B') || typeof b.rssi !== 'number' || !Number.isFinite(b.rssi)) {
    res.status(400).json({ error: 'need unit (A or B) and a numeric rssi' })
    return
  }
  hw.ingest(b as UnitReport)
  res.json({ ok: true })
})

const readings: Reading[] = []
const packets: PacketRecord[] = []
const messages: MessageRecord[] = []
const filtered: FilteredEvent[] = []
const loraLog: LoraMessage[] = []
const pongs: PongRecord[] = []
const fresh = (): UnitTotals => ({ received: 0, accuracySum: 0, stutter: 0, ambient: 0 })
const totals: Record<UnitId, UnitTotals> = { A: fresh(), B: fresh() }
let scenario = 'clear'
let device: DeviceStatus | null = null
let deviceConnected = false

app.get('/health', (_req, res) => res.json({ status: 'ok', source: SOURCE, deviceConnected, time: new Date().toISOString() }))
app.get('/api/latest', (_req, res) => res.json(readings.at(-1) ?? null))
app.get('/api/device', (_req, res) => res.json(device))
app.get('/api/history', (req, res) => {
  const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes) || 60))
  res.json({ samples: store.history(minutes), persistence: store.persistence })
})

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGINS } })
const sim = createSimulator(() => settings)

function emitEvent(severity: LinkEvent['severity'], type: string, message: string) {
  const e: LinkEvent = { id: randomUUID(), ts: Date.now(), severity, type, message }
  store.addEvent(e)
  io.emit('event', e)
}

// ---------------------------------------------------------------- hardware (USB serial)
let bridge: DeviceBridge | null = null

function onDeviceLine(o: Record<string, unknown>) {
  switch (o.t) {
        case 'status': {
      const s = o as unknown as DeviceStatus
      if (typeof s.env !== 'number' || (s.unit !== 'A' && s.unit !== 'B')) return
      device = { ...s, ts: Date.now() }
      io.emit('device', device)

      const MODE_MAP = ['auto', 'fso', 'rf'] as const
      const peerHeard = s.lora.ok === 1 && s.lora.peer !== '-' && s.lora.ageS >= 0 && s.lora.ageS <= 10
      hw.ingest({
        unit: s.unit,
        // threshold maps to 50 (placeholder, tune with real env/thr values)
        rssi: Math.min(100, Math.max(0, (s.env / Math.max(s.thr, 0.001)) * 50)),
        mode: MODE_MAP[s.mode] ?? 'auto',
        laserOk: s.laser === 1,
        channel: s.failover ? 'RF' : 'FSO',
        rfRssi: peerHeard ? s.lora.rssi : undefined,
        rfSnr: peerHeard ? s.lora.snr : undefined,
      })
      break
    }
    case 'event':
      break // path/failover events are raised by hardware.ts, so they are not duplicated here
    // Failover and mode events come from hardware.ts, so the 'path' line is not turned into an event here
    case 'cal':
      emitEvent('Info', 'calibration', `Link threshold set to ${Number(o.thr).toFixed(3)} (noise mean ${Number(o.mean).toFixed(3)})`)
      break
    case 'lora_msg': {
      const m: LoraMessage = {
        id: randomUUID(), ts: Date.now(), from: String(o.from ?? '?'),
        rssi: Number(o.rssi) || 0, snr: Number(o.snr) || 0, text: String(o.text ?? '').slice(0, 200),
      }
      loraLog.push(m)
      if (loraLog.length > MAX_LORA_LOG) loraLog.shift()
      io.emit('lora:msg', m)
      break
    }
    case 'pong': {
      const p: PongRecord = {
        id: randomUUID(), ts: Date.now(), from: String(o.from ?? '?'), seq: String(o.seq ?? ''),
        rssi: Number(o.rssi) || 0, snr: Number(o.snr) || 0,
      }
      pongs.push(p)
      if (pongs.length > MAX_LORA_LOG) pongs.shift()
      io.emit('lora:pong', p)
      break
    }
    case 'hello':
      emitEvent('Info', 'device', `Unit ${String(o.unit)} firmware ${String(o.fw)} online`)
      break
  }
}

   if (SOURCE === 'hardware') {
     const onConnection = (c: boolean) => {
       if (c === deviceConnected) return
       deviceConnected = c
       if (!c) device = null
       io.emit('device:connection', c)
       emitEvent(c ? 'Info' : 'Critical', 'device', c ? 'Device connected' : 'Device disconnected')
     }
     if (process.env.MOCK_DEVICE === 'true') {
       bridge = createMockDevice({ onLine: onDeviceLine, onConnection })
     } else {
       const path = process.env.SERIAL_PATH
       if (!path) {
         console.error('DATA_SOURCE=hardware but SERIAL_PATH is not set (example: COM5 or /dev/ttyUSB0)')
       } else {
         bridge = createSerialBridge({
           path, baudRate: Number(process.env.SERIAL_BAUD) || 115200, onLine: onDeviceLine, onConnection,
         })
       }
     }
   }

// ---------------------------------------------------------------- command validation
const SET_RANGES: Record<string, [number, number]> = {
  txSrc: [0, 4], rxSink: [0, 2], vol: [0.05, 1], rxGain: [1, 60], micGain: [0.5, 30], duck: [0, 1], gate: [0, 1],
}
function validateCommand(c: unknown): DeviceCommand | null {
  if (typeof c !== 'object' || c === null) return null
  const o = c as Record<string, unknown>
  switch (o.cmd) {
    case 'set': {
      const r = typeof o.k === 'string' ? SET_RANGES[o.k] : undefined
      const v = Number(o.v)
      if (!r || !Number.isFinite(v)) return null
      return { cmd: 'set', k: o.k as never, v: Math.min(r[1], Math.max(r[0], v)) }
    }
    case 'mode': {
      const v = Number(o.v)
      return v === 0 || v === 1 || v === 2 ? { cmd: 'mode', v } : null
    }
    case 'cal': return { cmd: 'cal' }
    case 'ping': return { cmd: 'ping' }
    case 'msg': {
      const text = typeof o.text === 'string' ? o.text.replace(/[\r\n]/g, ' ').slice(0, 40).trim() : ''
      return text ? { cmd: 'msg', text } : null
    }
    default: return null
  }
}

// ---------------------------------------------------------------- sockets
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id)
  const canCommand = !COMMAND_TOKEN || socket.handshake.auth?.token === COMMAND_TOKEN

  socket.emit('init', {
    readings, events: store.events, packets, messages, filtered, totals, runs: store.runs, activeRun: store.activeRun(),
    settings, scenario, source: SOURCE, persistence: store.persistence,
    device, deviceConnected, loraLog, pongs, canCommand,
  })

  socket.on('sim:inject', (kind) => { if (SOURCE === 'simulator') sim.inject(kind) })
  socket.on('sim:aim', (cmd) => {
    if (SOURCE === 'simulator' && typeof cmd === 'object' && cmd !== null) sim.aim(cmd as AimCommand)
  })

  socket.on('device:command', (raw) => {
    if (SOURCE !== 'hardware' || !bridge) return
    if (!canCommand) { socket.emit('device:ack', { ok: false, error: 'not authorised' }); return }
    const cmd = validateCommand(raw)
    if (!cmd) { socket.emit('device:ack', { ok: false, error: 'invalid command' }); return }
    const sent = bridge.send(cmd)
    socket.emit('device:ack', { ok: sent, error: sent ? undefined : 'device not connected' })
  })

  socket.on('settings:update', (patch) => {
    if (typeof patch !== 'object' || patch === null) return
    settings = sanitize(patch as Partial<Settings>, settings)
    saveSettings(settings)
    io.emit('settings', settings)
  })

  socket.on('run:start', (p: { distanceM?: unknown; notes?: unknown }) => {
    const distanceM = Math.min(100000, Math.max(0, Number(p?.distanceM) || 0))
    const notes = typeof p?.notes === 'string' ? p.notes.slice(0, 200) : ''
    const run = store.startRun(distanceM, notes)
    if (!run) return
    emitEvent('Info', 'run', `Test run started at ${distanceM} m`)
    io.emit('run:active', run)
  })

  socket.on('run:stop', async () => {
    const done = await store.stopRun()
    if (!done) return
    emitEvent('Info', 'run', `Test run stopped: ${done.samples} s, average RSSI ${done.avgRssi.toFixed(1)}`)
    io.emit('run:active', null)
    io.emit('run:done', done)
  })

  socket.on('disconnect', () => console.log('Dashboard disconnected:', socket.id))
})

setInterval(() => {
  const step = SOURCE === 'hardware' ? hw.step() : sim.step()
  if (!step) return
  const { reading } = step
  readings.push(reading)
  if (readings.length > MAX_READINGS) readings.shift()
  store.addReading(reading)
  const live = store.updateRun(reading)

  io.emit('reading', reading)
  for (const e of step.events) {
    store.addEvent(e)
    io.emit('event', e)
  }
  for (const m of step.messages) {
    messages.push(m)
    if (messages.length > MAX_MESSAGES) messages.shift()
    totals[m.to].received++
    totals[m.to].accuracySum += m.accuracy
    io.emit('message', m)
  }
  for (const f of step.filtered) {
    filtered.push(f)
    if (filtered.length > MAX_MESSAGES) filtered.shift()
    totals[f.to][f.kind]++
    io.emit('filtered', f)
  }
  if (step.messages.length || step.filtered.length) io.emit('totals', totals)
  packets.push(...step.packets)
  if (packets.length > MAX_PACKETS) packets.splice(0, packets.length - MAX_PACKETS)
  io.emit('packets', step.packets)

  if (step.scenario !== scenario) {
    scenario = step.scenario
    io.emit('scenario', scenario)
  }
  if (live) io.emit('run:active', live)
}, TICK_MS)

const PORT = process.env.PORT || 4000
server.listen(PORT, () => console.log(`Backend running on port ${PORT} (source: ${SOURCE})`))