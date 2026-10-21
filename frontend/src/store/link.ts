import { create } from 'zustand'
import type { Socket } from 'socket.io-client'
import { socket } from '../lib/socket'
export { BACKEND_URL } from '../lib/socket'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { LinkEvent, Reading, Run, Settings } from '../types'

const MAX_READINGS = 120
const MAX_EVENTS = 500

// Display zones are browser preferences, never firmware controls.
const ZONE_KEY = 'beambi.zones.v3'
type Zones = Pick<Settings, 'failBelow' | 'lockAbove'>

function readZones(): Zones {
  let failBelow: number = DEFAULT_SETTINGS.failBelow
  let lockAbove: number = DEFAULT_SETTINGS.lockAbove
  try {
    const z = JSON.parse(localStorage.getItem(ZONE_KEY) ?? '{}')
    if (Number.isFinite(z.failBelow)) failBelow = Math.min(80, Math.max(1, z.failBelow))
    if (Number.isFinite(z.lockAbove)) lockAbove = Math.min(95, Math.max(2, z.lockAbove))
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
}

type LinkStore = {
  connected: boolean
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
  latest: null,
  readings: [],
  events: [],
  runs: [],
  activeRun: null,
  settings: { ...DEFAULT_SETTINGS, ...readZones() },
  socket: null,

  connect: () => {
    if (get().socket) return // already connected
    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))
    socket.on('init', (d: Init) =>
      set({
        readings: d.readings,
        events: d.events,
        runs: d.runs ?? [],
        activeRun: d.activeRun ?? null,
        latest: d.readings.at(-1) ?? null,
      }),
    )
    socket.on('reading', (r: Reading) =>
      set((s) => ({ latest: r, readings: [...s.readings, r].slice(-MAX_READINGS) })),
    )
    socket.on('event', (e: LinkEvent) => set((s) => ({ events: [...s.events, e].slice(-MAX_EVENTS) })))
    socket.on('run:active', (run: Run | null) => set({ activeRun: run }))
    socket.on('run:done', (run: Run) => set((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)].slice(0, 50) })))
    set({ socket })
    socket.connect()
  },

  updateSettings: (patch) => {
    const next: Settings = { ...get().settings, ...patch }
    // Keep lock above failover
    if (patch.lockAbove !== undefined && next.failBelow >= next.lockAbove) next.failBelow = Math.max(0, next.lockAbove - 1)
    else if (patch.failBelow !== undefined && next.lockAbove <= next.failBelow) next.lockAbove = next.failBelow + 1

    set({ settings: next })
    saveZones(next)

  },

  startRun: (distanceM, notes) => get().socket?.emit('run:start', { distanceM, notes }),
  stopRun: () => get().socket?.emit('run:stop'),
}))