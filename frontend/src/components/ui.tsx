import type { ReactNode } from 'react'
import { useLink } from '../store/link'

export type Tone = 'default' | 'ok' | 'warn' | 'crit'

export const toneText: Record<Tone, string> = {
  default: 'text-forest-900',
  ok: 'text-ok-ink',
  warn: 'text-warn-ink',
  crit: 'text-crit-ink',
}
export const toneChip: Record<Tone, string> = {
  default: 'bg-mint-200 text-forest-800',
  ok: 'bg-ok/15 text-ok-ink',
  warn: 'bg-warn/20 text-warn-ink',
  crit: 'bg-crit/15 text-crit-ink',
}
export const toneSolid: Record<Tone, string> = {
  default: 'bg-forest-800 text-white',
  ok: 'bg-ok-ink text-white',
  warn: 'bg-warn text-forest-950',
  crit: 'bg-crit-ink text-white',
}
export const toneFill: Record<Tone, string> = {
  default: 'bg-forest-700',
  ok: 'bg-leaf-500',
  warn: 'bg-warn',
  crit: 'bg-crit',
}

type BigProps = { children: ReactNode; tone?: Tone; stencil?: boolean; mono?: boolean; size?: 'lg' | 'md' }

// The main readout of a panel
export function Big({ children, tone = 'default', stencil = false, mono = false, size = 'lg' }: BigProps) {
  const face = stencil ? 'font-stencil tracking-wide' : mono ? 'font-mono font-medium tracking-tight' : 'font-display font-bold'
  return <div className={`${face} ${size === 'lg' ? 'text-5xl' : 'text-4xl'} leading-none ${toneText[tone]}`}>{children}</div>
}

export function Sub({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-snug text-moss-600">{children}</p>
}

export function Row({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-forest-900/10 py-2 last:border-b-0">
      <span className="text-sm text-moss-600">{label}</span>
      <span className={`text-right font-mono text-[15px] font-medium tabular-nums ${toneText[tone]}`}>{value}</span>
    </div>
  )
}

export function Pill({ tone = 'default', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneChip[tone]}`}>{children}</span>
}

export function Bar({ pct, tone = 'ok' }: { pct: number; tone?: Tone }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-forest-900/10">
      <div className={`h-full rounded-full transition-[width] duration-500 ${toneFill[tone]}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

// Says where the numbers come from, so simulated values are never mistaken for measurements
export function SourceTag() {
  const source = useLink((s) => s.source)
  if (source === 'simulator') return <Pill tone="warn">Simulated data</Pill>
  if (source) return <Pill tone="ok">Measured data</Pill>
  return <Pill>No data yet</Pill>
}
