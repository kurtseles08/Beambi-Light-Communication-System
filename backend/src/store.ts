import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LinkEvent, Reading, Run, Sample, Severity } from './types.js'

const SOURCE = 'simulator' // becomes 'hardware' when real telemetry replaces the simulator
const SAMPLE_MS = 5000
const MAX_AGE_MS = 24 * 3600 * 1000
const MAX_EVENTS = 500
const PAGE = 1000

export function toSample(r: Reading): Sample {
  return {
    ts: r.ts, ch: r.activeChannel, state: r.linkState,
    rssi: r.fso.rssi, snr: r.fso.snr, berPre: r.fso.berPre, berPost: r.fso.berPost,
    latencyMs: (r.ab.latencyMs + r.ba.latencyMs) / 2,
    bitrateKbps: (r.ab.bitrateKbps + r.ba.bitrateKbps) / 2,
    loss: (r.ab.packetLoss + r.ba.packetLoss) / 2,
    lux: r.fso.ambientLux, tempC: r.env.temperatureC, hum: r.env.humidityPct,
    batA: r.units.A.battery, batB: r.units.B.battery,
  }
}

const iso = (ts: number) => new Date(ts).toISOString()

const sampleToRow = (s: Sample) => ({
  ts: iso(s.ts), source: SOURCE, active_channel: s.ch, link_state: s.state,
  rssi: s.rssi, snr: s.snr, ber_pre: s.berPre, ber_post: s.berPost,
  latency_ms: s.latencyMs, bitrate_kbps: s.bitrateKbps, frame_loss: s.loss,
  ambient_lux: s.lux, temperature_c: s.tempC, humidity_pct: s.hum, battery_a: s.batA, battery_b: s.batB,
})

// Rows come back from an untyped Supabase client, so keep this loose
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const rowToSample = (r: Row): Sample => ({
  ts: Date.parse(r.ts), ch: r.active_channel, state: r.link_state,
  rssi: r.rssi, snr: r.snr, berPre: r.ber_pre, berPost: r.ber_post,
  latencyMs: r.latency_ms, bitrateKbps: r.bitrate_kbps, loss: r.frame_loss,
  lux: r.ambient_lux, tempC: r.temperature_c, hum: r.humidity_pct, batA: r.battery_a, batB: r.battery_b,
})

const eventToRow = (e: LinkEvent) => ({
  id: e.id, ts: iso(e.ts), source: SOURCE, severity: e.severity, type: e.type, message: e.message,
  unit: e.unit ?? null, duration_sec: e.durationSec ?? null,
})
const rowToEvent = (r: Row): LinkEvent => ({
  id: r.id, ts: Date.parse(r.ts), severity: r.severity as Severity, type: r.type, message: r.message,
  ...(r.unit ? { unit: r.unit } : {}), ...(r.duration_sec != null ? { durationSec: r.duration_sec } : {}),
})

const runToRow = (r: Run) => ({
  id: r.id, source: SOURCE, started_at: iso(r.startedAt), ended_at: r.endedAt ? iso(r.endedAt) : null,
  distance_m: r.distanceM, notes: r.notes, samples: r.samples, avg_rssi: r.avgRssi, min_rssi: r.minRssi,
  max_rssi: r.maxRssi, avg_snr: r.avgSnr, pdr: r.pdr, failovers: r.failovers, locked_pct: r.lockedPct,
})
const rowToRun = (r: Row): Run => ({
  id: r.id, startedAt: Date.parse(r.started_at), endedAt: r.ended_at ? Date.parse(r.ended_at) : null,
  distanceM: r.distance_m, notes: r.notes ?? '', samples: r.samples, avgRssi: r.avg_rssi, minRssi: r.min_rssi,
  maxRssi: r.max_rssi, avgSnr: r.avg_snr, pdr: r.pdr, failovers: r.failovers, lockedPct: r.locked_pct,
})

// Average numbers inside buckets so a 24 h range still draws as a few hundred points
function downsample(rows: Sample[], max: number): Sample[] {
  if (rows.length <= max) return rows
  const size = Math.ceil(rows.length / max)
  const out: Sample[] = []
  for (let i = 0; i < rows.length; i += size) {
    const b = rows.slice(i, i + size)
    const avg = (f: (s: Sample) => number) => b.reduce((a, s) => a + f(s), 0) / b.length
    const last = b[b.length - 1]
    out.push({
      ts: last.ts, ch: last.ch, state: last.state,
      rssi: avg((s) => s.rssi), snr: avg((s) => s.snr), berPre: avg((s) => s.berPre), berPost: avg((s) => s.berPost),
      latencyMs: avg((s) => s.latencyMs), bitrateKbps: avg((s) => s.bitrateKbps), loss: avg((s) => s.loss),
      lux: avg((s) => s.lux), tempC: avg((s) => s.tempC), hum: avg((s) => s.hum),
      batA: last.batA, batB: last.batB,
    })
  }
  return out
}

type Active = {
  run: Run
  sumRssi: number
  sumSnr: number
  locked: number
  startSent: number
  startRecv: number
  startFailovers: number
  sent: number
  recv: number
}

export async function createStore() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  // Opt-in: set PERSIST_HISTORY=true in backend/.env once the history tables exist
  const enabled = Boolean(url && key && process.env.PERSIST_HISTORY === 'true')
  const db: SupabaseClient | null = enabled && url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  let dbOk = db !== null

  const samples: Sample[] = []
  const events: LinkEvent[] = []
  const runs: Run[] = []
  const pendingSamples: Sample[] = []
  const pendingEvents: LinkEvent[] = []
  let lastSampleTs = 0
  let active: Active | null = null

  // --- Load what was saved before the last restart
  if (db) {
    try {
      const since = iso(Date.now() - MAX_AGE_MS)
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from('link_readings').select('*').eq('source', SOURCE)
          .gte('ts', since).order('ts', { ascending: true }).range(from, from + PAGE - 1)
        if (error) throw error
        samples.push(...data.map(rowToSample))
        if (data.length < PAGE) break
      }
      const ev = await db.from('events').select('*').eq('source', SOURCE)
        .order('ts', { ascending: false }).limit(MAX_EVENTS)
      if (ev.error) throw ev.error
      events.push(...ev.data.reverse().map(rowToEvent))
      const rs = await db.from('test_runs').select('*').eq('source', SOURCE)
        .order('started_at', { ascending: false }).limit(50)
      if (rs.error) throw rs.error
      runs.push(...rs.data.map(rowToRun))
      console.log(`Supabase connected: loaded ${samples.length} samples, ${events.length} events, ${runs.length} runs`)
    } catch (e) {
      dbOk = false
      console.error('Supabase unavailable, history will be kept in memory only:', e instanceof Error ? e.message : e)
    }
  } else {
    console.log('History is kept in memory (Supabase saving is off)')
  }

  async function flush() {
    if (!db || !dbOk) return
    const s = pendingSamples.splice(0)
    const e = pendingEvents.splice(0)
    try {
      if (s.length) {
        const { error } = await db.from('link_readings').insert(s.map(sampleToRow))
        if (error) throw error
      }
      if (e.length) {
        const { error } = await db.from('events').upsert(e.map(eventToRow))
        if (error) throw error
      }
    } catch (err) {
      console.error('Supabase write failed, will retry:', err instanceof Error ? err.message : err)
      pendingSamples.unshift(...s)
      pendingEvents.unshift(...e)
      if (pendingSamples.length > 5000) pendingSamples.splice(0, pendingSamples.length - 5000)
      if (pendingEvents.length > 1000) pendingEvents.splice(0, pendingEvents.length - 1000)
    }
  }
  setInterval(flush, 30_000)

  // --- Recording
  function addReading(r: Reading) {
    if (r.ts - lastSampleTs >= SAMPLE_MS) {
      lastSampleTs = r.ts
      const s = toSample(r)
      samples.push(s)
      pendingSamples.push(s)
      while (samples.length && samples[0].ts < r.ts - MAX_AGE_MS) samples.shift()
    }
  }

  function addEvent(e: LinkEvent) {
    events.push(e)
    if (events.length > MAX_EVENTS) events.shift()
    pendingEvents.push(e)
  }

  // --- Test runs
  const snapshot = (a: Active): Run => {
    const n = Math.max(1, a.run.samples)
    return {
      ...a.run,
      avgRssi: a.sumRssi / n,
      avgSnr: a.sumSnr / n,
      pdr: a.sent > 0 ? (a.recv / a.sent) * 100 : 100,
      lockedPct: (a.locked / n) * 100,
    }
  }

  function startRun(distanceM: number, notes: string): Run | null {
    if (active) return null
    const run: Run = {
      id: randomUUID(), startedAt: Date.now(), endedAt: null, distanceM, notes,
      samples: 0, avgRssi: 0, minRssi: 100, maxRssi: 0, avgSnr: 0, pdr: 100, failovers: 0, lockedPct: 0,
    }
    active = { run, sumRssi: 0, sumSnr: 0, locked: 0, startSent: -1, startRecv: 0, startFailovers: 0, sent: 0, recv: 0 }
    return run
  }

  // Call once per reading. Returns the live run (or null when none is active).
  function updateRun(r: Reading): Run | null {
    const a = active
    if (!a) return null
    const sent = r.ab.framesSent + r.ba.framesSent
    const recv = r.ab.framesReceived + r.ba.framesReceived
    if (a.startSent < 0) {
      a.startSent = sent
      a.startRecv = recv
      a.startFailovers = r.session.failovers
    }
    a.run.samples++
    a.sumRssi += r.fso.rssi
    a.sumSnr += r.fso.snr
    a.run.minRssi = Math.min(a.run.minRssi, r.fso.rssi)
    a.run.maxRssi = Math.max(a.run.maxRssi, r.fso.rssi)
    if (r.linkState === 'Locked' && r.activeChannel === 'FSO') a.locked++
    a.sent = sent - a.startSent
    a.recv = recv - a.startRecv
    a.run.failovers = r.session.failovers - a.startFailovers
    return snapshot(a)
  }

  async function stopRun(): Promise<Run | null> {
    const a = active
    if (!a) return null
    active = null
    const done = { ...snapshot(a), endedAt: Date.now() }
    runs.unshift(done)
    if (runs.length > 50) runs.pop()
    if (db && dbOk) {
      const { error } = await db.from('test_runs').upsert(runToRow(done))
      if (error) console.error('Could not save test run:', error.message)
    }
    return done
  }

  function history(minutes: number): Sample[] {
    const since = Date.now() - minutes * 60_000
    const start = samples.findIndex((s) => s.ts >= since)
    return downsample(start < 0 ? [] : samples.slice(start), 360)
  }

  return {
    persistence: (db && dbOk ? 'supabase' : 'memory') as 'supabase' | 'memory',
    events, runs,
    activeRun: () => (active ? snapshot(active) : null),
    addReading, addEvent, startRun, updateRun, stopRun, history,
  }
}
