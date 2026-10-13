import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import type { AimCommand, FilteredEvent, Inject, LinkEvent, MessageRecord, Reading, Settings, UnitId, UnitTotals } from '../types'

export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'
const MAX_READINGS = 120
const MAX_EVENTS = 500
const MAX_MESSAGES = 200

const noTotals = (): Record<UnitId, UnitTotals> => ({
  A: { received: 0, accuracySum: 0, stutter: 0, ambient: 0 },
  B: { received: 0, accuracySum: 0, stutter: 0, ambient: 0 },
})

type Init = {
  readings: Reading[]
  events: LinkEvent[]
  messages?: MessageRecord[]
  filtered?: FilteredEvent[]
  totals?: Record<UnitId, UnitTotals>
  settings: Settings
  scenario: string
  source: string
}

type LinkStore = {
  connected: boolean
  source: string | null
  latest: Reading | null
  readings: Reading[]
  events: LinkEvent[]
  messages: MessageRecord[]
  filtered: FilteredEvent[]
  totals: Record<UnitId, UnitTotals>
  settings: Settings
  scenario: string
  socket: Socket | null
  connect: () => void
  inject: (kind: Inject) => void
  aim: (cmd: AimCommand) => void
  updateSettings: (patch: Partial<Settings>) => void
}

export const useLink = create<LinkStore>((set, get) => ({
  connected: false,
  source: null,
  latest: null,
  readings: [],
  events: [],
  messages: [],
  filtered: [],
  totals: noTotals(),
  settings: DEFAULT_SETTINGS,
  scenario: 'clear',
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
        messages: d.messages ?? [],
        filtered: d.filtered ?? [],
        totals: d.totals ?? noTotals(),
        settings: { ...DEFAULT_SETTINGS, ...d.settings },
        scenario: d.scenario,
        source: d.source,
        latest: d.readings.at(-1) ?? null,
      }),
    )
    socket.on('reading', (r: Reading) =>
      set((s) => ({ latest: r, readings: [...s.readings, r].slice(-MAX_READINGS) })),
    )
    socket.on('event', (e: LinkEvent) => set((s) => ({ events: [...s.events, e].slice(-MAX_EVENTS) })))
    socket.on('message', (m: MessageRecord) => set((s) => ({ messages: [...s.messages, m].slice(-MAX_MESSAGES) })))
    socket.on('filtered', (f: FilteredEvent) => set((s) => ({ filtered: [...s.filtered, f].slice(-MAX_MESSAGES) })))
    socket.on('totals', (totals: Record<UnitId, UnitTotals>) => set({ totals }))
    socket.on('settings', (settings: Settings) => set({ settings }))
    socket.on('scenario', (scenario: string) => set({ scenario }))
    set({ socket })
  },

  inject: (kind) => get().socket?.emit('sim:inject', kind),

  // Alignment practice (simulator only)
  aim: (cmd) => get().socket?.emit('sim:aim', cmd),

  // Applies at once on screen, then the backend confirms the cleaned-up values
  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    get().socket?.emit('settings:update', patch)
  },
}))
