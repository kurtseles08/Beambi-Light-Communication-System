import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { LinkEvent, Reading, Run, Settings } from '../types'

export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'
const MAX_READINGS = 120
const MAX_EVENTS = 500

// The two display zones live in the browser so a backend echo can never move the sliders back
const ZONE_KEY = 'beambi.zones'
type Zones = Pick<Settings, 'failBelow' | 'lockAbove'>

function readZones(): Zones {
  let failBelow: number = DEFAULT_SETTINGS.failBelow
  let lockAbove: number = DEFAULT_SETTINGS.lockAbove
  try {
    const z = JSON.parse(localStorage.getItem(ZONE_KEY) ?? '{}')
    if (Number.isFinite(z.failBelow)) failBelow = z.failBelow
    if (Number.isFinite(z.lockAbove)) lockAbove = z.lockAbove
  } catch {
    /* storage unavailable, use defaults */
  }
  return { failBelow, lockAbove: Math.max(lockAbove, failBelow + 1) }
}

function saveZones(s: Settings) {
  try {
    localStorage.setItem(ZONE_KEY, JSON.stringify({ failBelow: s.failBelow, lockAbove: s.lockAbove }))
  } catch {
    /* ignore */
  }
}

type Init = {
  readings: Reading[]
  events: LinkEvent[]
  runs?: Run[]
  activeRun?: Run | null
  settings: Settings
}

type LinkStore = {
  connected: boolean
  source: string | null
  latest: Reading | null
  readings: Reading[]
  events: LinkEvent[]
  runs: Run[]
  activeRun: Run | null
  settings: Settings
  socket: Socket | null
  connect: () => void
  updateSettings: (patch: Partial<Settings>) => void
  startRun: (distanceM: number, notes: string) => void
  stopRun: () => void
}

// Slider drags are sent to the backend in one batch, 250 ms after the last move
let pending: Partial<Settings> = {}
let timer: ReturnType<typeof setTimeout> | null = null
let lastEdit = 0

export const useLink = create<LinkStore>((set, get) => ({
  connected: false,
  source: null,
  latest: null,
  readings: [],
  events: [],
  runs: [],
  activeRun: null,
  settings: { ...DEFAULT_SETTINGS, ...readZones() },
  socket: null,

  connect: () => {
    if (get().socket) return // already connected
    const socket = io(BACKEND_URL)
    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))
    socket.on('init', (d: Init) =>
      set({
        readings: d.readings,
        events: d.events,
        runs: d.runs ?? [],
        activeRun: d.activeRun ?? null,
        settings: { ...DEFAULT_SETTINGS, ...d.settings, ...readZones() },
        latest: d.readings.at(-1) ?? null,
      }),
    )
    socket.on('reading', (r: Reading) =>
      set((s) => ({ latest: r, readings: [...s.readings, r].slice(-MAX_READINGS) })),
    )
    socket.on('event', (e: LinkEvent) => set((s) => ({ events: [...s.events, e].slice(-MAX_EVENTS) })))
    socket.on('run:active', (run: Run | null) => set({ activeRun: run }))
    socket.on('run:done', (run: Run) => set((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)].slice(0, 50) })))
    socket.on('settings', (settings: Settings) => {
      if (Date.now() - lastEdit < 1000) return // ignore the echo of our own edit
      set({ settings: { ...DEFAULT_SETTINGS, ...settings, ...readZones() } })
    })
    set({ socket })
  },

  updateSettings: (patch) => {
    const next: Settings = { ...get().settings, ...patch }
    // Keep lock above failover
    if (patch.lockAbove !== undefined && next.failBelow >= next.lockAbove) next.failBelow = Math.max(0, next.lockAbove - 1)
    else if (patch.failBelow !== undefined && next.lockAbove <= next.failBelow) next.lockAbove = next.failBelow + 1

    lastEdit = Date.now()
    set({ settings: next })
    saveZones(next)

    pending = { ...pending, ...patch, failBelow: next.failBelow, lockAbove: next.lockAbove }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      get().socket?.emit('settings:update', pending)
      pending = {}
      timer = null
    }, 250)
  },

  startRun: (distanceM, notes) => get().socket?.emit('run:start', { distanceM, notes }),
  stopRun: () => get().socket?.emit('run:stop'),
}))