import Panel from '../components/Panel'

export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-sm text-moss-600">{note}</p>
      </div>
      <Panel title="Not built yet">
        <p className="text-sm text-moss-600">This screen is on the build list and will fill in as we get to it.</p>
      </Panel>
    </div>
  )
}