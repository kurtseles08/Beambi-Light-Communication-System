import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { recentReadings } from '../lib/freshness'
import type { Reading } from '../types'

type Props = { readings: Reading[]; fail: number; lock: number; height?: number }

const COLOR = { ok: '#3fae63', warn: '#d9962b', crit: '#d4492f' }
const TEXT = '#4e6b58'
const GRID = 'rgba(15, 42, 26, 0.12)'

// One bar per second for the last 60 seconds, colored by zone: green locked, amber marginal, red below failover
export default function RssiBars({ readings, fail, lock, height = 400 }: Props) {
  const recent = recentReadings(readings, 60)
  const data = recent.map((r) => ({ t: (r.ts - recent[recent.length - 1].ts) / 1000, rssi: r.fso.rssi }))
  // Round labels (-45s, -30s, -15s, now). Add the first bar's label only when it is not crowding the next one.
  const first = data.length ? data[0].t : 0
  const marks = [-45, -30, -15, 0].filter((t) => t >= first)
  const ticks = marks.length && marks[0] - first < 8 ? marks : [first, ...marks]
  const tick = { fill: TEXT, fontSize: 12 }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 14, right: 24, bottom: 4, left: 0 }} barCategoryGap="14%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" ticks={ticks} tickFormatter={(v: number) => (v === 0 ? 'now' : `${v <= -59 ? -60 : v}s`)} tick={tick} stroke={GRID} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={38} tick={tick} stroke={GRID} />
        <Tooltip
          cursor={{ fill: 'rgba(15, 42, 26, 0.06)' }}
          contentStyle={{ borderRadius: 12, border: '1px solid rgba(15,42,26,0.15)', fontSize: 13 }}
          labelFormatter={(l) => (Number(l) === 0 ? 'Now' : `${Math.abs(Number(l))} s ago`)}
          formatter={(value) => [Number(value).toFixed(1), 'RSSI']}
        />
        <Bar dataKey="rssi" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.t} fill={d.rssi >= lock ? COLOR.ok : d.rssi >= fail ? COLOR.warn : COLOR.crit} />
          ))}
        </Bar>
        <ReferenceLine y={lock} stroke="#1d6b3a" strokeDasharray="6 4" strokeWidth={2}
          label={{ value: `High ${lock}`, position: 'insideTopLeft', fill: '#1d6b3a', fontSize: 12, fontWeight: 600 }} />
        <ReferenceLine y={fail} stroke="#9b2c1f" strokeDasharray="6 4" strokeWidth={2}
          label={{ value: `Low ${fail}`, position: 'insideTopLeft', fill: '#9b2c1f', fontSize: 12, fontWeight: 600 }} />
      </BarChart>
    </ResponsiveContainer>
  )
}
