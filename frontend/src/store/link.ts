import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { LinkEvent, Reading, Run, Settings } from '../types'

export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'
const MAX_READINGS = 120
const MAX_EVENTS = 500

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

export const useLink = create<LinkStore>((set, get) => ({
  connected: false,
  source: null,
  latest: null,
  readings: [],
  events: [],
  runs: [],
  activeRun: null,
  settings: DEFAULT_SETTINGS,
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
        settings: { ...DEFAULT_SETTINGS, ...d.settings },
        latest: d.readings.at(-1) ?? null,
      }),
    )
    socket.on('reading', (r: Reading) =>
      set((s) => ({ latest: r, readings: [...s.readings, r].slice(-MAX_READINGS) })),
    )
    socket.on('event', (e: LinkEvent) => set((s) => ({ events: [...s.events, e].slice(-MAX_EVENTS) })))
    // Test runs: the backend sends the live run every second, and the finished run when it stops
    socket.on('run:active', (run: Run | null) => set({ activeRun: run }))
    socket.on('run:done', (run: Run) => set((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)].slice(0, 50) })))
    socket.on('settings', (settings: Settings) => set({ settings }))
    set({ socket })
  },

  // Applies at once on screen, then the backend confirms the cleaned-up values
  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    get().socket?.emit('settings:update', patch)
  },

  startRun: (distanceM, notes) => get().socket?.emit('run:start', { distanceM, notes }),
  stopRun: () => get().socket?.emit('run:stop'),
}))