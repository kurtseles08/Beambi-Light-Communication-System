import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function startBluetoothBridge() {
  if (process.env.BLE_ENABLED !== 'true') return
  const python = process.env.BLE_PYTHON || fileURLToPath(new URL(
    process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python', import.meta.url))
  if (!existsSync(python)) {
    console.error('[ble] Python environment missing; follow the Bluetooth setup in README.md')
    return
  }
  const child = spawn(python, ['-u', fileURLToPath(new URL('../ble_bridge.py', import.meta.url))], {
    stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  })
  child.on('error', (error) => console.error('[ble]', error.message))
  child.on('exit', (code) => {
    if (code) console.error(`[ble] receiver exited (${code}); check Bluetooth dependencies and restart backend`)
  })
  process.once('exit', () => child.kill())
}
