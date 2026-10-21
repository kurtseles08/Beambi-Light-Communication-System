import { useLink } from '../store/link'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import Panel from '../components/Panel'
import { Sub } from '../components/ui'

export default function Settings() {
  const settings = useLink((s) => s.settings)
  const update = useLink((s) => s.updateSettings)
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Display settings</h1>
      <Panel title="Signal display zones" index={1}>
        <Sub>Saved in this browser. These values color the signal charts; they do not change firmware thresholds, mode, or timing. Use Hardware for device controls and noise calibration.</Sub>
        <div className="mt-4 space-y-5">
          <label className="block">Low signal below: <span className="font-mono">{settings.failBelow}</span>
            <input aria-label="Low signal display threshold" type="range" min={1} max={80} value={settings.failBelow}
              onChange={(e) => update({ failBelow: Number(e.target.value) })} className="mt-2 block w-full accent-leaf-600" />
          </label>
          <label className="block">High signal at or above: <span className="font-mono">{settings.lockAbove}</span>
            <input aria-label="High signal display threshold" type="range" min={settings.failBelow + 1} max={95} value={settings.lockAbove}
              onChange={(e) => update({ lockAbove: Number(e.target.value) })} className="mt-2 block w-full accent-leaf-600" />
          </label>
          <button onClick={() => update({ ...DEFAULT_SETTINGS })} className="rounded-lg border border-forest-900/20 px-3 py-2 text-sm">Reset display defaults</button>
        </div>
      </Panel>
    </div>
  )
}
