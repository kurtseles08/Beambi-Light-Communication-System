import { create } from 'zustand'
import { fetchWeather, type Weather } from '../lib/weather'
import { fetchQuakes, type Quake } from '../lib/earthquakes'

type State = {
  weather: Weather | null
  weatherError: string | null
  quakes: Quake[]
  quakesError: string | null
  updated: number | null
  loading: boolean
  refresh: () => Promise<void>
}

export const useHazards = create<State>((set) => ({
  weather: null,
  weatherError: null,
  quakes: [],
  quakesError: null,
  updated: null,
  loading: false,
  refresh: async () => {
    set({ loading: true })
    const [w, q] = await Promise.allSettled([fetchWeather(), fetchQuakes()])
    set((s) => ({
      weather: w.status === 'fulfilled' ? w.value : s.weather,
      weatherError: w.status === 'rejected' ? String(w.reason?.message ?? w.reason) : null,
      quakes: q.status === 'fulfilled' ? q.value : s.quakes,
      quakesError: q.status === 'rejected' ? String(q.reason?.message ?? q.reason) : null,
      updated: Date.now(),
      loading: false,
    }))
  },
}))