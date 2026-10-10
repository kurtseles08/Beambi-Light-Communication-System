import { format, formatDistanceToNow } from 'date-fns'
import {
  RefreshCw, ExternalLink, Wind, Droplets, Eye, Thermometer, Cloud, Gauge,
  Sun, Moon, CloudSun, CloudRain, CloudDrizzle, CloudFog, CloudLightning,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useHazards } from '../store/hazards'
import { assess, type Level } from '../lib/hazardStatus'
import { describeWeather, fsoOutlook } from '../lib/weather'
import { LOCATION } from '../lib/config'
import Panel from '../components/Panel'
import Lamp, { type LampLevel } from '../components/Lamp'

const glyphs = {
  clear: Sun, night: Moon, partly: CloudSun, cloud: Cloud,
  fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, storm: CloudLightning,
} satisfies Record<string, LucideIcon>

function glyphKey(code: number, isDay: boolean): keyof typeof glyphs {
  if (code <= 1) return isDay ? 'clear' : 'night'
  if (code === 2) return isDay ? 'partly' : 'cloud'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code >= 95) return 'storm'
  if (code >= 61) return 'rain'
  return 'cloud'
}

function WeatherGlyph({ code, isDay }: { code: number; isDay: boolean }) {
  const Icon = glyphs[glyphKey(code, isDay)]
  return <Icon size={32} />
}

const levelView: Record<Level, { word: string; lamp: LampLevel }> = {
  unknown: { word: 'text-mint-100', lamp: 'off' },
  normal: { word: 'text-leaf-400', lamp: 'ok' },
  watch: { word: 'text-warn-soft', lamp: 'warn' },
  warning: { word: 'text-crit-soft', lamp: 'crit' },
}

const outlookView = {
  good: { word: 'text-leaf-400', bar: 'bg-leaf-400' },
  reduced: { word: 'text-warn-soft', bar: 'bg-warn-soft' },
  poor: { word: 'text-crit-soft', bar: 'bg-crit-soft' },
}

const sources = [
  { name: 'PAGASA', desc: 'Weather, typhoon bulletins, rainfall warnings', url: 'https://www.pagasa.dost.gov.ph/' },
  { name: 'PHIVOLCS', desc: 'Official earthquake and volcano bulletins', url: 'https://earthquake.phivolcs.dost.gov.ph/' },
  { name: 'NDRRMC', desc: 'National disaster situational reports', url: 'https://ndrrmc.gov.ph/' },
]

const idx = (i: number) => ({ '--i': i }) as CSSProperties

function Corners() {
  const base = 'pointer-events-none absolute h-4 w-4 border-brass-500'
  return (
    <>
      <span aria-hidden className={`${base} -left-px -top-px border-l-2 border-t-2`} />
      <span aria-hidden className={`${base} -right-px -top-px border-r-2 border-t-2`} />
      <span aria-hidden className={`${base} -bottom-px -left-px border-b-2 border-l-2`} />
      <span aria-hidden className={`${base} -bottom-px -right-px border-b-2 border-r-2`} />
    </>
  )
}

function Glass({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/15 bg-white/10 backdrop-blur-md ${className}`}>{children}</div>
  )
}

function Tile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-forest-900/10 bg-mint-50 p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-moss-600">
        <Icon size={14} /> {label}
      </div>
      <div className="mt-1 font-mono text-xl font-medium tabular-nums">{value}</div>
    </div>
  )
}

export default function DisasterStatus() {
  const { weather, weatherError, quakes, quakesError, updated, loading, refresh } = useHazards()
  const status = assess(weather, quakes)
  const view = levelView[status.level]
  const outlook = weather ? fsoOutlook(weather) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rise flex flex-wrap items-end justify-between gap-3" style={idx(0)}>
        <div>
          <h1 className="text-3xl font-bold">Disaster Status</h1>
          <p className="mt-1 text-[15px] text-moss-600">
            {LOCATION.name} · {updated ? `Updated ${format(updated, 'HH:mm:ss')}` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-forest-900/15 bg-white px-3.5 py-2 text-sm font-medium shadow-card transition-colors hover:bg-mint-200 disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* A. Situation overview */}
      <section className="rise relative overflow-hidden rounded-2xl bg-forest-900 p-3 text-mint-100 shadow-card" style={idx(1)}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-leaf-500/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-12 h-64 w-64 rounded-full bg-forest-700 blur-3xl" />

        <div className="relative rounded-xl border border-white/15 p-4 md:p-5">
          <Corners />
          <div className="mb-3 font-display text-sm font-semibold uppercase tracking-[0.18em] text-leaf-400">
            Situation overview
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Glass className="p-4">
              <div className="text-sm text-mint-100/70">Overall status</div>
              <div className="mt-2 flex items-center gap-3">
                <Lamp level={view.lamp} size="lg" />
                <span className={`font-stencil text-4xl uppercase tracking-wide ${view.word}`}>{status.label}</span>
              </div>
              <ul className="mt-3 space-y-0.5 text-sm text-mint-100/90">
                {status.reasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </Glass>

            <Glass className="p-4">
              <div className="text-sm text-mint-100/70">Weather now</div>
              {weather ? (
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/10 text-leaf-400">
                    <WeatherGlyph code={weather.code} isDay={weather.isDay} />
                  </div>
                  <div>
                    <div className="font-display text-2xl font-semibold">{describeWeather(weather.code).label}</div>
                    <div className="font-mono text-3xl tabular-nums text-white">{weather.temperature.toFixed(1)}°C</div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-mint-100/80">
                  {weatherError ? `Could not load weather: ${weatherError}` : 'Loading weather...'}
                </p>
              )}
            </Glass>

            <Glass className="relative overflow-hidden p-4 pl-5">
              {outlook && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${outlookView[outlook.tone].bar}`} />}
              <div className="text-sm text-mint-100/70">FSO link outlook (weather-based estimate)</div>
              {outlook ? (
                <>
                  <div className={`mt-2 font-display text-3xl font-semibold ${outlookView[outlook.tone].word}`}>
                    {outlook.label}
                  </div>
                  <p className="mt-1 text-sm text-mint-100/90">{outlook.note}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-mint-100/80">Waiting for weather...</p>
              )}
            </Glass>
          </div>

          <p className="mt-3 text-xs text-mint-100/60">
            Computed from Open-Meteo weather and USGS earthquake data. Not an official warning.
            {weatherError && weather ? ' Showing last known weather.' : ''}
          </p>
        </div>
      </section>

      {/* B. Weather details */}
      <Panel title="Weather details" index={2}>
        {weather ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile icon={Thermometer} label="Feels like" value={`${weather.feelsLike.toFixed(1)} °C`} />
            <Tile icon={Droplets} label="Humidity" value={`${weather.humidity}%`} />
            <Tile icon={CloudRain} label="Rain (1h)" value={`${weather.precipitation.toFixed(1)} mm`} />
            <Tile icon={Cloud} label="Cloud cover" value={`${weather.cloudCover}%`} />
            <Tile icon={Wind} label="Wind" value={`${Math.round(weather.windSpeed)} km/h`} />
            <Tile icon={Wind} label="Gusts" value={`${Math.round(weather.windGusts)} km/h`} />
            <Tile
              icon={Eye}
              label="Visibility"
              value={weather.visibility === null ? '--' : `${(weather.visibility / 1000).toFixed(1)} km`}
            />
            <Tile icon={Gauge} label="Pressure" value={`${Math.round(weather.pressure)} hPa`} />
          </div>
        ) : (
          <p className="text-sm text-moss-600">No weather data yet.</p>
        )}
      </Panel>

      {/* C. Earthquakes and official sources */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Panel
          title="Recent earthquakes"
          index={3}
          className="lg:col-span-8"
          right={<span className="text-[13px] text-moss-600">Philippines · M3.0+ · 7 days · USGS</span>}
        >
          {quakesError && quakes.length === 0 && (
            <p className="text-sm text-crit-ink">Could not load earthquakes: {quakesError}</p>
          )}
          {!quakesError && updated && quakes.length === 0 && (
            <p className="text-sm text-moss-600">No earthquakes of magnitude 3.0+ in the last 7 days.</p>
          )}
          <div className="divide-y divide-forest-900/10">
            {quakes.map((q) => (
              <a
                key={q.id}
                href={q.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-4 py-3 transition-colors hover:bg-mint-50"
              >
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-mono text-lg font-semibold ${
                    q.magnitude >= 5
                      ? 'bg-crit/15 text-crit-ink'
                      : q.magnitude >= 4
                        ? 'bg-warn/20 text-warn-ink'
                        : 'bg-mint-200 text-forest-800'
                  }`}
                >
                  {q.magnitude.toFixed(1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{q.place}</div>
                  <div className="text-[13px] text-moss-600">
                    {formatDistanceToNow(q.time, { addSuffix: true })} · {format(q.time, 'MMM d, HH:mm')} · depth{' '}
                    {Math.round(q.depthKm)} km
                  </div>
                </div>
                <ExternalLink size={14} className="shrink-0 text-moss-600" />
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="Official sources" index={4} className="lg:col-span-4">
          <div className="space-y-2.5">
            {sources.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-forest-900/10 p-3.5 transition-colors hover:border-leaf-500 hover:bg-mint-50"
              >
                <div className="flex items-center justify-between font-display text-lg font-semibold">
                  {s.name} <ExternalLink size={14} className="text-moss-600" />
                </div>
                <p className="text-[13px] text-moss-600">{s.desc}</p>
              </a>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-moss-600">
            Typhoon tracks are not shown here because PAGASA has no public data feed. Use the links above.
          </p>
        </Panel>
      </div>
    </div>
  )
}