import { format, formatDistanceToNow } from 'date-fns'
import {
  RefreshCw, ExternalLink, Wind, Droplets, Eye, Thermometer, Cloud, Gauge, CloudRain,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useHazards } from '../store/hazards'
import { assess, levelStyles } from '../lib/hazardStatus'
import { describeWeather, fsoOutlook } from '../lib/weather'
import { LOCATION } from '../lib/config'

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon size={14} /> {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

const outlookStyles = {
  good: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  reduced: 'border-amber-600 bg-amber-500/10 text-amber-300',
  poor: 'border-red-600 bg-red-500/10 text-red-300',
}

const sources = [
  { name: 'PAGASA', desc: 'Weather, typhoon bulletins, rainfall warnings', url: 'https://www.pagasa.dost.gov.ph/' },
  { name: 'PHIVOLCS', desc: 'Official earthquake and volcano bulletins', url: 'https://earthquake.phivolcs.dost.gov.ph/' },
  { name: 'NDRRMC', desc: 'National disaster situational reports', url: 'https://ndrrmc.gov.ph/' },
]

export default function DisasterStatus() {
  const { weather, weatherError, quakes, quakesError, updated, loading, refresh } = useHazards()
  const status = assess(weather, quakes)
  const outlook = weather ? fsoOutlook(weather) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Disaster Status</h1>
          <p className="text-sm text-slate-400">
            {LOCATION.name} · {updated ? `Updated ${format(updated, 'hh:mm:ss a')}` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Overall status */}
      <section className={`rounded-xl border p-5 ${levelStyles[status.level]}`}>
        <div className="text-xs uppercase tracking-wide opacity-80">Overall status</div>
        <div className="mt-1 text-3xl font-bold">{status.label}</div>
        <ul className="mt-2 text-sm">
          {status.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs opacity-70">
          Computed from Open-Meteo weather and USGS earthquake data. Not an official warning. Check the official sources below.
        </p>
      </section>

      {/* Weather today */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Weather today</h2>
        {weatherError && !weather && (
          <p className="rounded-lg border border-red-800 bg-red-500/10 p-3 text-sm text-red-300">
            Could not load weather: {weatherError}
          </p>
        )}
        {weather && (
          <>
            <div className="mb-3 flex items-center gap-3">
              <CloudRain className="text-sky-400" />
              <span className="text-xl font-semibold">{describeWeather(weather.code).label}</span>
              {weatherError && <span className="text-xs text-amber-400">(showing last known data)</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat icon={Thermometer} label="Temperature" value={`${weather.temperature.toFixed(1)} °C`} />
              <Stat icon={Thermometer} label="Feels like" value={`${weather.feelsLike.toFixed(1)} °C`} />
              <Stat icon={Droplets} label="Humidity" value={`${weather.humidity}%`} />
              <Stat icon={CloudRain} label="Rain (last hour)" value={`${weather.precipitation.toFixed(1)} mm`} />
              <Stat icon={Wind} label="Wind" value={`${Math.round(weather.windSpeed)} km/h`} />
              <Stat icon={Wind} label="Gusts" value={`${Math.round(weather.windGusts)} km/h`} />
              <Stat
                icon={Eye}
                label="Visibility"
                value={weather.visibility === null ? '--' : `${(weather.visibility / 1000).toFixed(1)} km`}
              />
              <Stat icon={Cloud} label="Cloud cover" value={`${weather.cloudCover}%`} />
              <Stat icon={Gauge} label="Pressure" value={`${Math.round(weather.pressure)} hPa`} />
            </div>
          </>
        )}
      </section>

      {/* FSO outlook */}
      {outlook && (
        <section className={`rounded-xl border p-5 ${outlookStyles[outlook.tone]}`}>
          <div className="text-xs uppercase tracking-wide opacity-80">FSO link outlook (weather-based estimate)</div>
          <div className="mt-1 text-2xl font-bold">{outlook.label}</div>
          <p className="mt-1 text-sm">{outlook.note}</p>
        </section>
      )}

      {/* Earthquakes */}
      <section>
        <h2 className="mb-1 text-lg font-semibold">Recent earthquakes</h2>
        <p className="mb-3 text-xs text-slate-500">Philippine region, magnitude 3.0+, last 7 days (USGS)</p>
        {quakesError && quakes.length === 0 && (
          <p className="rounded-lg border border-red-800 bg-red-500/10 p-3 text-sm text-red-300">
            Could not load earthquakes: {quakesError}
          </p>
        )}
        {!quakesError && updated && quakes.length === 0 && (
          <p className="text-sm text-slate-400">No earthquakes of magnitude 3.0+ in the last 7 days.</p>
        )}
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
          {quakes.map((q) => (
            <a
              key={q.id}
              href={q.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 p-4 hover:bg-slate-800/60"
            >
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${
                  q.magnitude >= 5
                    ? 'bg-red-500/20 text-red-300'
                    : q.magnitude >= 4
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-slate-800 text-slate-300'
                }`}
              >
                {q.magnitude.toFixed(1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{q.place}</div>
                <div className="text-xs text-slate-400">
                  {formatDistanceToNow(q.time, { addSuffix: true })} · {format(q.time, 'MMM d, hh:mm a')} · depth{' '}
                  {Math.round(q.depthKm)} km
                </div>
              </div>
              <ExternalLink size={14} className="shrink-0 text-slate-500" />
            </a>
          ))}
        </div>
      </section>

      {/* Official sources */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Official sources</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {sources.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-sky-700"
            >
              <div className="flex items-center justify-between font-semibold">
                {s.name} <ExternalLink size={14} className="text-slate-500" />
              </div>
              <p className="mt-1 text-xs text-slate-400">{s.desc}</p>
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Typhoon tracks and signals are not shown here because PAGASA has no public data feed. Use the links above.
        </p>
      </section>
    </div>
  )
}