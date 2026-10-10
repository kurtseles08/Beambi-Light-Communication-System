const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Point on the semicircle: f = 0 is the left end, f = 1 is the right end
const polar = (f: number, r: number) => {
  const a = Math.PI * (1 - f)
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)]
}

type Props = { value: number; min?: number; max?: number; markers?: number[]; label: string }

export default function Gauge({ value, min = 0, max = 100, markers = [], label }: Props) {
  const f = clamp((value - min) / (max - min), 0, 0.999)
  const [x, y] = polar(f, 80)
  const color =
    value < 30 ? 'stroke-red-500' : value < 50 ? 'stroke-amber-400' : 'stroke-emerald-400'

  return (
    <div className="mx-auto w-full max-w-xs">
      <svg viewBox="0 0 200 115" className="w-full">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-slate-800" />
        <path d={`M 20 100 A 80 80 0 0 1 ${x} ${y}`} fill="none" strokeWidth="14" strokeLinecap="round" className={`${color} transition-all duration-500`} />
        {markers.map((m) => {
          const [x1, y1] = polar((m - min) / (max - min), 68)
          const [x2, y2] = polar((m - min) / (max - min), 92)
          return <line key={m} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="2" className="stroke-slate-300" />
        })}
        <text x="100" y="92" textAnchor="middle" className="fill-slate-100 text-3xl font-bold">
          {value.toFixed(0)}
        </text>
        <text x="100" y="110" textAnchor="middle" className="fill-slate-400 text-[9px]">
          {label}
        </text>
      </svg>
    </div>
  )
}