import { useLink } from '../store/link'
import { useDevice } from '../device/deviceStore'
import { isFresh } from '../lib/freshness'
import { useNow } from './useNow'

export function useTelemetry() {
  const latest = useLink((s) => s.latest)
  const readings = useLink((s) => s.readings)
  const connected = useLink((s) => s.connected)
  const now = useNow()
  const fresh = isFresh(latest, connected, now)
  return { latest: fresh ? latest : null, readings: fresh ? readings : [], connected }
}

export function useFreshDevices() {
  const state = useDevice()
  const now = useNow()
  const a = isFresh(state.devices.A, state.backendUp, now)
  const b = isFresh(state.devices.B, state.backendUp, now)
  const summary = isFresh(state.device, state.backendUp, now)
  return {
    ...state,
    device: summary ? state.device : null,
    deviceConnected: summary,
    devices: { A: a ? state.devices.A : null, B: b ? state.devices.B : null },
    unitsOnline: { A: a, B: b },
  }
}
