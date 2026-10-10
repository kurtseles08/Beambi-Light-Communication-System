import type { CSSProperties, ReactNode } from 'react'

type Tone = 'default' | 'ok' | 'warn' | 'crit'

const stripe: Record<Tone, string> = {
  default: 'bg-brass-500',
  ok: 'bg-leaf-500',
  warn: 'bg-warn',
  crit: 'bg-crit',
}

type Props = {
  title: string
  tone?: Tone
  right?: ReactNode
  index?: number
  className?: string
  children: ReactNode
}

export default function Panel({ title, tone = 'default', right, index, className = '', children }: Props) {
  return (
    <section
      style={{ '--i': index } as CSSProperties}
      className={`rise relative overflow-hidden rounded-2xl border border-forest-900/15 bg-white shadow-card ${className}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${stripe[tone]}`} />
      <span aria-hidden className="absolute right-3 top-3 h-2.5 w-2.5 border-r-2 border-t-2 border-brass-500" />
      <header className="flex items-center justify-between gap-3 border-b border-forest-900/10 bg-mint-50 py-3 pl-6 pr-10">
        <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-forest-800">{title}</h2>
        {right}
      </header>
      <div className="p-5 pl-6">{children}</div>
    </section>
  )
}