export type LampLevel = 'ok' | 'warn' | 'crit' | 'off'

const styles: Record<LampLevel, string> = {
  ok: 'bg-leaf-400 shadow-[0_0_8px_1px_var(--color-leaf-400)]',
  warn: 'bg-warn-soft shadow-[0_0_8px_1px_var(--color-warn-soft)]',
  crit: 'animate-pulse bg-crit-soft shadow-[0_0_8px_1px_var(--color-crit-soft)]',
  off: 'bg-white/25',
}

export default function Lamp({ level, size = 'sm' }: { level: LampLevel; size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${size === 'lg' ? 'h-4 w-4' : 'h-2.5 w-2.5'} ${styles[level]}`}
    />
  )
}