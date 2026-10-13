import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { Server } from 'socket.io'
import { createSimulator } from './simulator.js'
import { createStore } from './store.js'
import { loadSettings, sanitize, saveSettings } from './settings.js'
import type { AimCommand, FilteredEvent, LinkEvent, MessageRecord, PacketRecord, Reading, Settings, UnitId, UnitTotals } from './types.js'

const TICK_MS = 1000
const MAX_READINGS = 120
const MAX_PACKETS = 200
const MAX_MESSAGES = 200
const ORIGINS = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173']

let settings: Settings = loadSettings()
const store = await createStore()

const app = express()
app.use(cors({ origin: ORIGINS }))
app.use(express.json())

const readings: Reading[] = []
const packets: PacketRecord[] = []
const messages: MessageRecord[] = []
const filtered: FilteredEvent[] = []
const fresh = (): UnitTotals => ({ received: 0, accuracySum: 0, stutter: 0, ambient: 0 })
const totals: Record<UnitId, UnitTotals> = { A: fresh(), B: fresh() }
let scenario = 'clear'

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
app.get('/api/latest', (_req, res) => res.json(readings.at(-1) ?? null))
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

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id)
  socket.emit('init', {
    readings, events: store.events, packets, messages, filtered, totals, runs: store.runs, activeRun: store.activeRun(),
    settings, scenario, source: 'simulator', persistence: store.persistence,
  })

  socket.on('sim:inject', (kind) => sim.inject(kind))
  socket.on('sim:aim', (cmd) => {
    if (typeof cmd === 'object' && cmd !== null) sim.aim(cmd as AimCommand)
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
  const step = sim.step()
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
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`))
