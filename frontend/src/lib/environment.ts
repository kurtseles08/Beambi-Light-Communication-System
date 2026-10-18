import type { Reading, Settings } from '../types'

// Infers the weather around the beam from the signal alone, plus the humidity sensor.
// Uses only Reading fields, so it works the same with real hardware.

export type Condition = 'clear' | 'fog' | 'rain' | 'dust' | 'obstruction' | 'unclear'
export const CONDITIONS: Condition[] = ['clear', 'fog', 'rain', 'dust', 'obstruction']
export const conditionLabel: Record<Condition, string> = {
  clear: 'Clear', fog: 'Fog', rain: 'Rain', dust: 'Dust', obstruction: 'Obstruction', unclear: 'Unclear',
}

export type Trend = 'sudden' | 'worsening' | 'recovering' | 'steady'
export type Confidence = 'low' | 'medium' | 'high'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// Least-squares slope for values sampled once per second (units per second)
function slope(ys: number[]) {
  const n = ys.length
  if (n < 3) return 0
  const mx = (n - 1) / 2
  const my = mean(ys)
  let num = 0
  let den = 0
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my)
    den += (i - mx) ** 2
  })
  return den ? num / den : 0
}

// How much of the clear-air signal is lost, in %
export const attenuationOf = (rssi: number, clearRssi: number) => clamp((1 - rssi / clearRssi) * 100, 0, 100)

// Dew point in °C (Magnus formula)
export function dewPoint(tempC: number, humidityPct: number) {
  const a = 17.62
  const b = 243.12
  const g = Math.log(Math.max(humidityPct, 1) / 100) + (a * tempC) / (b + tempC)
  return (b * g) / (a - g)
}

export type Environment = {
  condition: Condition
  confidence: Confidence
  reasons: string[]
  attenuation: number // % lost, averaged over 10 s
  trend: Trend
  slopePer10s: number // change in attenuation, points per 10 s
  marginFail: number // RSSI points above the failover level
  marginLock: number // RSSI points above the lock level
  secondsToFail: number | null // at the current rate of fall, null when not falling
  tempC: number
  humidity: number
  dewPointC: number
  spreadC: number // temperature minus dew point. Under 2.5 °C fog forms easily.
  lux: number
  luxLevel: 'Normal' | 'High' | 'Critical'
  luxPctOfWarn: number
}

// rainMm: rain at the station from the weather service, or null when unknown
export function evaluateEnvironment(readings: Reading[], s: Settings, rainMm: number | null): Environment | null {
  const last = readings.at(-1)
  if (!last) return null
  const rssi = last.fso.rssi
  const att = readings.map((r) => attenuationOf(r.fso.rssi, s.clearRssi))
  const att10 = mean(att.slice(-10))
  const slopePer10s = slope(att.slice(-30)) * 10

  // A fall of 15+ points in one second within the last 8 s is a blocked beam, not weather
  const w8 = readings.slice(-8).map((r) => r.fso.rssi)
  const stepDown = w8.some((v, i) => i > 0 && w8[i - 1] - v >= 15)
  const sudden = stepDown && att10 > 30

  const trend: Trend = sudden ? 'sudden' : slopePer10s >= 3 ? 'worsening' : slopePer10s <= -3 ? 'recovering' : 'steady'

  const { temperatureC: tempC, humidityPct: humidity } = last.env
  const dew = dewPoint(tempC, humidity)
  const spread = tempC - dew
  const lux = last.fso.ambientLux
  const luxLevel = lux >= s.ambientCritLux ? 'Critical' : lux >= s.ambientWarnLux ? 'High' : 'Normal'

  const marginFail = rssi - s.failBelow
  const rssiSlope = slope(readings.slice(-15).map((r) => r.fso.rssi)) // points per second
  const secondsToFail = marginFail > 0 && rssiSlope < -0.2 ? marginFail / -rssiSlope : null

  let condition: Condition
  let confidence: Confidence
  const reasons: string[] = []

  if (rssi < 8 || sudden) {
    condition = 'obstruction'
    confidence = 'high'
    reasons.push(rssi < 8 ? 'Almost no light is reaching the receiver.' : 'The signal fell sharply within a few seconds.')
    reasons.push('Weather changes slowly. A sudden drop points to something blocking the beam.')
  } else if (att10 < 12) {
    condition = 'clear'
    confidence = 'high'
    reasons.push(`The signal is within ${att10.toFixed(0)}% of its clear-air level.`)
  } else {
    confidence = att10 >= 30 ? 'high' : 'medium'
    reasons.push(`The signal has lost ${att10.toFixed(0)}% of its clear-air strength, gradually.`)
    if (rainMm !== null && rainMm >= 0.2) {
      condition = 'rain'
      reasons.push(`The weather service reports ${rainMm.toFixed(1)} mm of rain in the last hour.`)
    } else if (humidity >= 85 || spread < 2.5) {
      condition = 'fog'
      reasons.push(`Humidity is ${humidity.toFixed(0)}% and the air is ${spread.toFixed(1)} °C from its dew point.`)
    } else if (humidity <= 60) {
      condition = 'dust'
      reasons.push(`The air is dry (${humidity.toFixed(0)}% humidity), so droplets are unlikely. Dust or haze fits better.`)
    } else {
      condition = 'unclear'
      confidence = 'low'
      reasons.push(`Humidity is normal (${humidity.toFixed(0)}%), so weather is not the obvious cause.`)
      reasons.push('Check the mount alignment on the Alignment screen.')
    }
  }
  if (luxLevel !== 'Normal' && condition !== 'clear') reasons.push('Strong ambient light is also adding noise.')

  return {
    condition, confidence, reasons, attenuation: att10, trend, slopePer10s, marginFail,
    marginLock: rssi - s.lockAbove, secondsToFail, tempC, humidity, dewPointC: dew, spreadC: spread,
    lux, luxLevel, luxPctOfWarn: (lux / s.ambientWarnLux) * 100,
  }
}