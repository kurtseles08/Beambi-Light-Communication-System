import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'
import { createSimulator } from './simulator.js'
import type { LinkEvent, Reading } from './types.js'

const TICK_MS = 1000
const MAX_READINGS = 120
const MAX_EVENTS = 100
const ORIGINS = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173']

const app = express()
app.use(cors({ origin: ORIGINS }))
app.use(express.json())

const readings: Reading[] = []
const events: LinkEvent[] = []

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
app.get('/api/latest', (_req, res) => res.json(readings.at(-1) ?? null))

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGINS } })
const sim = createSimulator()

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id)
  socket.emit('init', { readings, events, source: 'simulator' })
  socket.on('sim:inject', (kind) => sim.inject(kind))
  socket.on('disconnect', () => console.log('Dashboard disconnected:', socket.id))
})

setInterval(() => {
  const { reading, newEvents } = sim.step()
  readings.push(reading)
  if (readings.length > MAX_READINGS) readings.shift()
  io.emit('reading', reading)
  for (const e of newEvents) {
    events.push(e)
    if (events.length > MAX_EVENTS) events.shift()
    io.emit('event', e)
  }
}, TICK_MS)

const PORT = process.env.PORT || 4000
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`))