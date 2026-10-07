import { LOCATION } from './config'

export type Weather = {
  temperature: number
  feelsLike: number
  humidity: number
  precipitation: number // mm, preceding hour
  windSpeed: number // km/h
  windGusts: number // km/h
  cloudCover: number // %
  pressure: number // hPa
  visibility: number | null // meters
  code: number // WMO weather code
  isDay: boolean
}

export async function fetchWeather(): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.lat),
    longitude: String(LOCATION.lon),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m,visibility,is_day',
    timezone: 'Asia/Manila',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`)
  const { current: c } = await res.json()
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    precipitation: c.precipitation,
    windSpeed: c.wind_speed_10m,
    windGusts: c.wind_gusts_10m,
    cloudCover: c.cloud_cover,
    pressure: c.pressure_msl,
    visibility: c.visibility ?? null,
    code: c.weather_code,
    isDay: c.is_day === 1,
  }
}

export type Severity = 'ok' | 'watch' | 'warn'

export function describeWeather(code: number): { label: string; severity: Severity } {
  if (code === 0) return { label: 'Clear sky', severity: 'ok' }
  if (code === 1) return { label: 'Mostly clear', severity: 'ok' }
  if (code === 2) return { label: 'Partly cloudy', severity: 'ok' }
  if (code === 3) return { label: 'Overcast', severity: 'ok' }
  if (code === 45 || code === 48) return { label: 'Fog', severity: 'watch' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', severity: 'watch' }
  if (code === 65 || code === 67) return { label: 'Heavy rain', severity: 'warn' }
  if (code >= 61 && code <= 66) return { label: 'Rain', severity: 'watch' }
  if (code === 82) return { label: 'Violent rain showers', severity: 'warn' }
  if (code >= 80 && code <= 81) return { label: 'Rain showers', severity: 'watch' }
  if (code === 95) return { label: 'Thunderstorm', severity: 'warn' }
  if (code === 96 || code === 99) return { label: 'Thunderstorm with hail', severity: 'warn' }
  return { label: 'Unknown', severity: 'ok' }
}

export type Outlook = { tone: 'good' | 'reduced' | 'poor'; label: string; note: string }

// Rough estimate only. Replace with real RSSI attenuation once hardware data exists.
export function fsoOutlook(w: Weather): Outlook {
  if (w.code === 45 || w.code === 48 || (w.visibility !== null && w.visibility < 1000))
    return { tone: 'poor', label: 'Poor', note: 'Fog or very low visibility will attenuate the laser beam. Expect RF failover.' }
  if (w.precipitation >= 5)
    return { tone: 'poor', label: 'Poor', note: 'Heavy rain scatters and absorbs the beam.' }
  if (w.windGusts >= 50)
    return { tone: 'reduced', label: 'Reduced', note: 'Strong gusts can shake the mounts and cause misalignment.' }
  if ((w.visibility !== null && w.visibility < 4000) || w.precipitation > 0)
    return { tone: 'reduced', label: 'Reduced', note: 'Light rain or haze may lower signal strength.' }
  return { tone: 'good', label: 'Good', note: 'Conditions are favorable for the laser link.' }
}