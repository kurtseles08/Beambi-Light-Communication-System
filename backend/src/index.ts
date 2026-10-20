import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { createStore } from './store.js'
import { loadSettings, sanitize, saveSettings } from './settings.js'
import { createHardware, type UnitReport } from './hardware.js'
import { createSerialBridge, type DeviceBridge } from './serial.js'
import { startBluetoothBridge } from './ble.js'
import type {
  DeviceCommand, DeviceStatus, LinkEvent, LoraMessage,
  PongRecord, Reading, Settings, UnitId,
} from './types.js'

const TICK_MS = 1000
const MAX_READINGS = 120
const MAX_LORA_LOG = 100
const STALE_MS = 5000
const ORIGINS = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173']
const COMMAND_TOKEN = process.env.COMMAND_TOKEN || ''
const DEVICE_KEY = process.env.DEVICE_KEY || ''
const SHOWN_UNIT: UnitId = process.env.SHOWN_UNIT === 'B' ? 'B' : 'A' // whose full panel /hardware shows
const MODE_MAP = ['auto', 'fso', 'rf'] as const // firmware mode 0, 1, 2

if (!COMMAND_TOKEN) {
  console.warn('COMMAND_TOKEN is not set: anyone who can reach this server can command the hardware')
}

let settings: Settings = loadSettings()
const store = await createStore()
const hw = createHardware(() => settings)

// ---------------------------------------------------------------- state
const readings: Reading[] = []
const loraLog: LoraMessage[] = []
const pongs: PongRecord[] = []
let device: DeviceStatus | null = null
let deviceConnected = false
const devices: Record<UnitId, DeviceStatus | null> = { A: null, B: null }
const lastSeen: Record<UnitId, number> = { A: 0, B: 0 }
const unitsOnline: Record<UnitId, boolean> = { A: false, B: false }
const wifiQueue: Record<UnitId, DeviceCommand[]> = { A: [], B: [] }
const serialUnits: Partial<Record<UnitId, DeviceBridge>> = {}

// Voice messages and packet logs are not reported by the firmware yet.
// They stay empty so the dashboard's init payload keeps its shape.

// ---------------------------------------------------------------- server
const app = express()
app.use(cors({ origin: ORIGINS }))
app.use(express.json())

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGINS } })

function emitEvent(severity: LinkEvent['severity'], type: string, message: string) {
  const e: LinkEvent = { id: randomUUID(), ts: Date.now(), severity, type, message }
  store.addEvent(e)
  io.emit('event', e)
}

function setDeviceConnected(c: boolean) {
  if (c === deviceConnected) return
  deviceConnected = c
  if (!c) device = null
  io.emit('device:connection', c)
  emitEvent(c ? 'Info' : 'Critical', 'device', c ? 'Device connected' : 'Device disconnected')
}

// ---------------------------------------------------------------- HTTP routes
app.get('/health', (_req, res) => res.json({ status: 'ok', source: 'hardware', deviceConnected,
  transport: device?.transport ?? null, time: new Date().toISOString() }))
app.get('/api/latest', (_req, res) => res.json(readings.at(-1) ?? null))
app.get('/api/device', (req, res) => {
  const unit = req.query.unit
  if (unit !== undefined && unit !== 'A' && unit !== 'B') {
    res.status(400).json({ error: 'unit must be A or B' })
    return
  }
  res.json(unit ? devices[unit] : device)
})
app.get('/api/history', (req, res) => {
  const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes) || 60))
  res.json({ samples: store.history(minutes), persistence: store.persistence })
})

// Optional HTTP ingest of a simple per-unit report. Disabled unless DEVICE_KEY is set.
app.post('/api/telemetry', (req, res) => {
  if (!DEVICE_KEY) { res.status(403).json({ error: 'disabled (set DEVICE_KEY)' }); return }
  if (req.get('x-api-key') !== DEVICE_KEY) { res.status(401).json({ error: 'bad key' }); return }
  const b = req.body as Partial<UnitReport> | undefined
  if (!b || (b.unit !== 'A' && b.unit !== 'B') || typeof b.rssi !== 'number' || !Number.isFinite(b.rssi)) {
    res.status(400).json({ error: 'need unit (A or B) and a numeric rssi' })
    return
  }
  hw.ingest(b as UnitReport)
  res.json({ ok: true })
})

// One endpoint for everything a Wi-Fi unit says: status, hello, cal, lora_msg, pong.
// The reply carries any dashboard commands waiting for that unit.
app.post('/api/device', (req, res) => {
  if (!DEVICE_KEY) { res.status(403).json({ error: 'disabled (set DEVICE_KEY)' }); return }
  if (req.get('x-api-key') !== DEVICE_KEY) { res.status(401).json({ error: 'bad key' }); return }
  const b = req.body as Record<string, unknown> | undefined
  if (!b || typeof b.t !== 'string') { res.status(400).json({ error: 'need t' }); return }
  const unit: UnitId | null = b.unit === 'A' || b.unit === 'B' ? b.unit : null
  if (b.t === 'status' && !unit) { res.status(400).json({ error: 'need unit A or B' }); return }
  onDeviceLine(b)
  res.json({ ok: true, cmds: unit ? wifiQueue[unit].splice(0) : [] })
})

// ---------------------------------------------------------------- device messages (USB or Wi-Fi)
function onDeviceLine(o: Record<string, unknown>) {
  switch (o.t) {
    case 'status': {
      const s = o as unknown as DeviceStatus
      if (!Number.isFinite(s.env) || !Number.isFinite(s.thr) || !s.lora ||
          (s.unit !== 'A' && s.unit !== 'B')) return
      devices[s.unit] = { ...s, ts: Date.now() }
      lastSeen[s.unit] = Date.now()
      io.emit('devices', devices)
      // The summary always follows SHOWN_UNIT, regardless of transport.
      if (s.unit === SHOWN_UNIT) {
        setDeviceConnected(true)
        device = { ...s, ts: Date.now() }
        io.emit('device', device)
      }

      const peerHeard = s.lora.ok === 1 && s.lora.peer !== '-' && s.lora.ageS >= 0 && s.lora.ageS <= 10
      const haveBat = typeof s.batPct === 'number' && s.batPct >= 0 && typeof s.batV === 'number' && s.batV > 0
      hw.ingest({
        unit: s.unit,
        // log scale: env = thr gives 50, 10x thr gives 100, 0.1x thr gives 0
        rssi: Math.min(100, Math.max(0, 50 + 50 * Math.log10(Math.max(s.env, 1e-4) / Math.max(s.thr, 1e-3)))),
        mode: MODE_MAP[s.mode] ?? 'auto',
        laserOk: s.laser === 1,
        channel: s.failover ? 'RF' : 'FSO',
        rfRssi: peerHeard ? s.lora.rssi : undefined,
        rfSnr: peerHeard ? s.lora.snr : undefined,
        battery: haveBat ? s.batPct : undefined,
        voltage: haveBat ? s.batV : undefined,
      })
      break
    }
    // Path, failover and mode events are raised by hardware.ts, so 'event' lines are ignored here.
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

// ---------------------------------------------------------------- USB serial (optional)
// SERIAL_PATH remains supported for a single board; SERIAL_PATHS accepts comma-separated ports.
const serialPaths = [...new Set((process.env.SERIAL_PATHS || process.env.SERIAL_PATH || '')
  .split(',').map((path) => path.trim()).filter(Boolean))]
for (const path of serialPaths) {
  // One USB gateway can report both its own unit and a LoRa peer.
  const routes = new Map<UnitId, DeviceBridge>()
  const bridge = createSerialBridge({
    path,
    baudRate: Number(process.env.SERIAL_BAUD) || 115200,
    onLine: (o) => {
      if (o.t === 'status' && typeof o.env === 'number' && (o.unit === 'A' || o.unit === 'B')) {
        const unit = o.unit
        let route = routes.get(unit)
        if (serialUnits[unit] && serialUnits[unit] !== route) {
          console.warn(`[serial] Duplicate UNIT_ID ${o.unit} reported on ${path}; check firmware IDs`)
        }
        if (!route) {
          route = { send: (cmd) => bridge.send({ ...cmd, target: unit }), isOpen: bridge.isOpen }
          routes.set(unit, route)
        }
        serialUnits[unit] = route
      }
      onDeviceLine(o)
    },
    onConnection: (connected) => {
      if (!connected) {
        for (const [unit, route] of routes) {
          if (serialUnits[unit] === route) delete serialUnits[unit]
        }
      }
    },
  })
}
if (!serialPaths.length) {
  console.log(process.env.BLE_ENABLED === 'true'
    ? '[hardware] Bluetooth mode: USB disabled. Waiting for BeamBi-A and its LoRa peer.'
    : '[hardware] No transport configured. Enable BLE_ENABLED=true for battery mode or set SERIAL_PATHS for USB.')
}

// ---------------------------------------------------------------- command validation
const SET_RANGES: Record<string, [number, number]> = {
  txSrc: [0, 4], rxSink: [0, 2], vol: [0.05, 1], rxGain: [1, 60], micGain: [0.5, 30], duck: [0, 1], gate: [0, 1],
  linkThresh: [0.005, 1], rxGate: [0, 1], rxNoiseFloor: [0.0005, 0.3],
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

// ---------------------------------------------------------------- offline detection
setInterval(() => {
  // Summary availability follows fresh telemetry from SHOWN_UNIT on either transport.
  if (deviceConnected && Date.now() - lastSeen[SHOWN_UNIT] >= STALE_MS) {
    setDeviceConnected(false)
  }

  // Per unit: no status for 5 s means that unit is offline
  let changed = false
  for (const u of ['A', 'B'] as const) {
    const on = Date.now() - lastSeen[u] < STALE_MS
    if (on === unitsOnline[u]) continue
    unitsOnline[u] = on
    changed = true
    if (!on) {
      devices[u] = null
      wifiQueue[u].length = 0
    }
    if (u !== SHOWN_UNIT) emitEvent(on ? 'Info' : 'Critical', 'device', `Unit ${u} ${on ? 'online' : 'offline'}`)
  }
  if (changed) {
    io.emit('devices:online', unitsOnline)
    io.emit('devices', devices)
  }
}, 1000)

// ---------------------------------------------------------------- sockets
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id)
  const canCommand = !COMMAND_TOKEN || socket.handshake.auth?.token === COMMAND_TOKEN

  socket.emit('init', {
    readings, events: store.events, runs: store.runs, activeRun: store.activeRun(),
    device, deviceConnected, loraLog, pongs, canCommand, devices, unitsOnline,
  })

  socket.on('device:command', (raw, target?: unknown) => {
    if (!canCommand) { socket.emit('device:ack', { ok: false, error: 'not authorised' }); return }
    const cmd = validateCommand(raw)
    if (!cmd) { socket.emit('device:ack', { ok: false, error: 'invalid command' }); return }

    const targets: UnitId[] = target === 'both' ? ['A', 'B'] : target === 'B' ? ['B'] : target === 'A' ? ['A'] : [SHOWN_UNIT]
    let ok = false
    for (const u of targets) {
      if (Date.now() - lastSeen[u] >= STALE_MS) continue
      const bridge = serialUnits[u]
      if (bridge?.isOpen()) {
        ok = bridge.send(cmd) || ok
      } else {
        // Wi-Fi units pick up queued commands with their next report.
        const q = wifiQueue[u]
        if (q.length >= 20) q.shift()
        q.push(cmd)
        ok = true
      }
    }
    socket.emit('device:ack', { ok, error: ok ? undefined : 'unit not connected' })
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

// ---------------------------------------------------------------- main loop
setInterval(() => {
  const step = hw.step() // null when no unit has reported recently, so the dashboard shows Offline
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
  if (live) io.emit('run:active', live)
}, TICK_MS)

const PORT = process.env.PORT || 4000
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
  startBluetoothBridge()
})
