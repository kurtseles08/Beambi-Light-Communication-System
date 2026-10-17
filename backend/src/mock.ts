import type { DeviceCommand, DeviceStatus } from './types.js'
import type { DeviceBridge } from './serial.js'

type Options = {
  onLine: (o: Record<string, unknown>) => void
  onConnection: (connected: boolean) => void
}

// Fake ESP32 for testing the dashboard without a board. Enabled with MOCK_DEVICE=true.
export function createMockDevice({ onLine, onConnection }: Options): DeviceBridge {
  const status: DeviceStatus = {
    t: 'status', unit: 'A', up: 0, laser: 1, env: 0.25, thr: 0.1, mode: 0, failover: 0,
    tx: 4, rx: 0, vol: 0.6, rxGain: 8, micGain: 4, duck: 0, gate: 0,
    micP2P: 800, panP2P: 1400, workAvg: 40, workMax: 60, over: 0, cal: 0,
    lora: { ok: 1, peer: 'B', peerLaser: 1, ageS: 1, rssi: -70, snr: 8, tx: 0, rx: 0 },
  }

  const startedAt = Date.now()
  const emitStatus = () => {
    status.up = Math.floor((Date.now() - startedAt) / 1000)
    // moving envelope, so the bar and the rssi mapping can be seen working
    status.env = Math.max(0, 0.25 + 0.12 * Math.sin(status.up / 3))
    status.laser = status.env > status.thr ? 1 : 0
    status.failover = status.mode === 2 ? 1 : status.mode === 1 ? 0 : status.laser ? 0 : 1
    status.lora.tx = status.up
    status.lora.rx = status.up
    onLine({ ...status, lora: { ...status.lora } })
  }

  onConnection(true)
  onLine({ t: 'hello', unit: status.unit, fw: 'mock' })
  emitStatus()
  setInterval(emitStatus, 1000)

  const fields = {
    txSrc: 'tx', rxSink: 'rx', vol: 'vol', rxGain: 'rxGain', micGain: 'micGain', duck: 'duck', gate: 'gate',
  } as const

  return {
    send: (command) => {
      const cmd = command as Partial<DeviceCommand>
      if (cmd.cmd === 'set') {
        const field = cmd.k ? fields[cmd.k] : undefined
        if (field && typeof cmd.v === 'number') Object.assign(status, { [field]: cmd.v })
      } else if (cmd.cmd === 'mode' && (cmd.v === 0 || cmd.v === 1 || cmd.v === 2)) {
        status.mode = cmd.v
      } else if (cmd.cmd === 'cal') {
        status.cal = 1
        setTimeout(() => {
          status.cal = 0
          onLine({ t: 'cal', thr: status.thr, mean: status.thr / 2 })
        }, 3000)
      } else if (cmd.cmd === 'ping') {
        onLine({ t: 'pong', from: 'B', seq: String(status.up), rssi: -70, snr: 8 })
      } else if (cmd.cmd === 'msg') {
        onLine({ t: 'lora_msg', from: 'B', rssi: -70, snr: 8, text: cmd.text })
      }
      emitStatus()
      return true
    },
    isOpen: () => true,
  }
}