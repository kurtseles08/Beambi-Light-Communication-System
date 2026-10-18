import { describeWeather, type Weather } from './weather'
import type { Quake } from './earthquakes'

export type Level = 'unknown' | 'normal' | 'watch' | 'warning'


const order: Level[] = ['unknown', 'normal', 'watch', 'warning']
const higher = (a: Level, b: Level): Level => (order.indexOf(a) >= order.indexOf(b) ? a : b)

const labels: Record<Level, string> = {
  unknown: '--',
  normal: 'Normal',
  watch: 'Watch',
  warning: 'Warning',
}

export function assess(weather: Weather | null, quakes: Quake[]) {
  if (!weather && quakes.length === 0)
    return { level: 'unknown' as Level, label: labels.unknown, reasons: ['Waiting for data...'] }

  let level: Level = 'normal'
  const reasons: string[] = []

  if (weather) {
    const d = describeWeather(weather.code)
    if (d.severity === 'warn') {
      level = higher(level, 'warning')
      reasons.push(d.label)
    } else if (d.severity === 'watch') {
      level = higher(level, 'watch')
      reasons.push(d.label)
    }
    if (weather.windGusts >= 90) {
      level = higher(level, 'warning')
      reasons.push(`Damaging wind gusts (${Math.round(weather.windGusts)} km/h)`)
    } else if (weather.windGusts >= 60) {
      level = higher(level, 'watch')
      reasons.push(`Strong wind gusts (${Math.round(weather.windGusts)} km/h)`)
    }
  }

  const dayAgo = Date.now() - 24 * 3600 * 1000
  const biggest = Math.max(0, ...quakes.filter((q) => q.time >= dayAgo).map((q) => q.magnitude))
  if (biggest >= 5.5) {
    level = higher(level, 'warning')
    reasons.push(`Magnitude ${biggest.toFixed(1)} earthquake in the last 24h`)
  } else if (biggest >= 4.5) {
    level = higher(level, 'watch')
    reasons.push(`Magnitude ${biggest.toFixed(1)} earthquake in the last 24h`)
  }

  if (reasons.length === 0) reasons.push('No hazards detected from current weather or recent earthquakes')
  return { level, label: labels[level], reasons }
}