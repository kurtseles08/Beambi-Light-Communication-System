import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import type { LinkEvent, Reading } from '../types'

const URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000'
const MAX_READINGS = 120
const MAX_EVENTS = 200

type LinkStore = {
  connected: boolean
  source: string | null
  latest: Reading | null
  readings: Reading[]
  events: LinkEvent[]
  socket: Socket | null
  connect: () => void
  inject: (kind: 'fog' | 'obstruction' | 'clear') => void
}

export const useLink = create<LinkStore>((set, get) => ({
  connected: false,
  source: null,
  latest: null,
  readings: [],
  events: [],
  socket: null,
  connect: () => {
    if (get().socket) return // already connected
    const socket = io(URL)
    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))
    socket.on('init', (d: { readings: Reading[]; events: LinkEvent[]; source: string }) =>
      set({ readings: d.readings, events: d.events, source: d.source, latest: d.readings.at(-1) ?? null }),
    )
    socket.on('reading', (r: Reading) =>
      set((s) => ({ latest: r, readings: [...s.readings, r].slice(-MAX_READINGS) })),
    )
    socket.on('event', (e: LinkEvent) => set((s) => ({ events: [...s.events, e].slice(-MAX_EVENTS) })))
    set({ socket })
  },
  inject: (kind) => get().socket?.emit('sim:inject', kind),
}))