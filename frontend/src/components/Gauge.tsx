const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Point on the semicircle: 0 is the left end, 1 is the right end
const polar = (f: number, r: number) => {
  const a = Math.PI * (1 - f)
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)]
}

type Props = { value: number; fail: number; lock: number; label?: string }

// 0-100 gauge with the failover and lock thresholds marked on the arc
export default function Gauge({ value, fail, lock, label = 'RSSI' }: Props) {
  const [x, y] = polar(clamp(value / 100, 0, 0.999), 80)
  const color = value < fail ? 'stroke-crit' : value < lock ? 'stroke-warn' : 'stroke-leaf-500'

  return (
    <svg viewBox="0 -12 200 130" role="img" aria-label={`${label} ${value.toFixed(0)} out of 100`} className="mx-auto w-full max-w-[17rem]">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-forest-900/10" />
      <path d={`M 20 100 A 80 80 0 0 1 ${x} ${y}`} fill="none" strokeWidth="14" strokeLinecap="round" className={`${color} transition-all duration-500`} />
      {[fail, lock].map((m) => {
        const [x1, y1] = polar(m / 100, 70)
        const [x2, y2] = polar(m / 100, 90)
        const [tx, ty] = polar(m / 100, 100)
        return (
          <g key={m}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2.5" className="stroke-forest-900" />
            <text x={tx} y={ty + 3} textAnchor="middle" className="fill-moss-600 text-[9px]">{m}</text>
          </g>
        )
      })}
      <text x="100" y="94" textAnchor="middle" className="fill-forest-900 font-mono text-4xl font-medium">{value.toFixed(0)}</text>
      <text x="100" y="112" textAnchor="middle" className="fill-moss-600 text-[10px]">{label}</text>
    </svg>
  )
}
