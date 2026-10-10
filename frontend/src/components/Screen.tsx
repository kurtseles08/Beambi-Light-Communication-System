import type { ReactNode } from 'react'
import Panel from './Panel'
import { screens, type Block, type Kind } from '../lib/screens'

const spans = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  8: 'lg:col-span-8',
  12: 'lg:col-span-12',
} as const

const heights = { sm: 'min-h-28', md: 'min-h-52', lg: 'min-h-80' } as const
const defaultHeight: Record<Kind, keyof typeof heights> = {
  kpi: 'sm', gauge: 'md', chart: 'md', table: 'md', form: 'md',
}

const bars = [40, 62, 48, 78, 58, 90, 68, 52, 74, 44, 66, 82]

function Sketch({ kind }: { kind: Kind }): ReactNode {
  switch (kind) {
    case 'kpi':
      return <div className="font-mono text-4xl font-medium text-forest-900/25">--</div>
    case 'gauge':
      return (
        <svg viewBox="0 0 200 110" aria-hidden className="mx-auto w-44 text-forest-900/20">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
        </svg>
      )
    case 'chart':
      return (
        <div aria-hidden className="flex h-28 items-end gap-1.5">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-forest-900/10" style={{ height: `${h}%` }} />
          ))}
        </div>
      )
    case 'table':
      return (
        <div aria-hidden className="space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-3 w-1/4 rounded bg-forest-900/10" />
              <div className="h-3 flex-1 rounded bg-forest-900/10" />
            </div>
          ))}
        </div>
      )
    case 'form':
      return (
        <div aria-hidden className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-3 w-2/5 rounded bg-forest-900/10" />
              <div className="h-5 w-10 rounded-full bg-forest-900/10" />
            </div>
          ))}
        </div>
      )
  }
}

function PlaceholderPanel({ block, index }: { block: Block; index: number }) {
  return (
    <Panel
      title={block.title}
      index={index + 1}
      className={spans[block.span]}
      right={
        <span className="rounded-full bg-mint-200 px-2.5 py-0.5 text-xs font-semibold text-forest-800">
          Placeholder
        </span>
      }
    >
      <div className={`flex flex-col gap-3 ${heights[block.height ?? defaultHeight[block.kind]]}`}>
        <div className="flex-1 rounded-xl border-2 border-dashed border-forest-900/15 bg-mint-50/70 p-4">
          <Sketch kind={block.kind} />
        </div>
        <p className="text-[13px] text-moss-600">{block.hint}</p>
      </div>
    </Panel>
  )
}

export default function Screen({ id }: { id: keyof typeof screens }) {
  const screen = screens[id]
  return (
    <div className="space-y-6">
      <div className="rise" style={{ '--i': 0 } as React.CSSProperties}>
        <h1 className="text-3xl font-bold">{screen.title}</h1>
        <p className="mt-1 text-[15px] text-moss-600">{screen.subtitle}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        {screen.blocks.map((b, i) => (
          <PlaceholderPanel key={b.title} block={b} index={i} />
        ))}
      </div>
    </div>
  )
}