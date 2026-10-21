import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { io } from '../frontend/node_modules/socket.io-client/build/esm/index.js'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function until(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out: ${event}`)) }, 10_000)
    const listener = (value) => {
      if (!predicate(value)) return
      clearTimeout(timer); socket.off(event, listener); resolve(value)
    }
    socket.on(event, listener)
  })
}

test('local API routes telemetry and commands, expires units, and keeps offline writes empty', { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./dist/index.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PORT: '0', BLE_ENABLED: 'false', SERIAL_PATH: '', SERIAL_PATHS: '',
      PERSIST_HISTORY: 'false', DEVICE_KEY: 'local-test-key', COMMAND_TOKEN: 'local-test-token' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => { output += data })
  child.stderr.on('data', (data) => { output += data })
  const sockets = []
  try {
    for (let n = 0; n < 100 && !output.match(/Backend running on port (\d+)/); n++) await pause(50)
    const port = output.match(/Backend running on port (\d+)/)?.[1]
    assert.ok(port, output)
    const base = `http://127.0.0.1:${port}`
    const post = (unit, key = 'local-test-key') => fetch(`${base}/api/device`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ t: 'status', unit, up: 10, env: 0.1, thr: 0.05, laser: 1, mode: 0,
        failover: 0, lora: { ok: 1, peer: unit === 'A' ? 'B' : 'A', ageS: 1 }, transport: 'bluetooth' }),
    })
    assert.equal((await post('A', 'wrong')).status, 401)
    const socket = io(base, { autoConnect: false, auth: { token: 'local-test-token' } })
    sockets.push(socket)
    const initialized = until(socket, 'init')
    socket.connect()
    assert.equal((await initialized).canCommand, true)
    await post('A'); await post('B')
    const reading = await until(socket, 'reading', (r) => r.units.A.online && r.units.B.online)
    assert.equal(reading.linkState, 'Locked')
    assert.equal('ab' in reading, false)
    const ack = until(socket, 'device:ack')
    socket.emit('device:command', { cmd: 'set', k: 'vol', v: 0.3 }, 'B')
    assert.equal((await ack).ok, true)
    assert.deepEqual((await (await post('A')).json()).cmds, [])
    assert.deepEqual((await (await post('B')).json()).cmds, [{ cmd: 'set', k: 'vol', v: 0.3 }])
    const rejected = until(socket, 'device:ack')
    socket.emit('device:command', { cmd: 'ping' }, 'A')
    assert.equal((await rejected).ok, false)
    const readonly = io(base, { autoConnect: false })
    sockets.push(readonly)
    const readonlyInit = until(readonly, 'init')
    readonly.connect()
    assert.equal((await readonlyInit).canCommand, false)
    const forbidden = until(readonly, 'device:ack')
    readonly.emit('device:command', { cmd: 'mode', v: 2 }, 'A')
    assert.equal((await forbidden).error, 'not authorised')
    const expired = await until(socket, 'devices:online', (u) => !u.A && !u.B)
    assert.deepEqual(expired, { A: false, B: false })
    assert.equal(await (await fetch(`${base}/api/device?unit=B`)).json(), null)
    assert.deepEqual((await (await fetch(`${base}/health`)).json()).pendingWrites, { samples: 0, events: 0 })
    assert.equal((await fetch(`${base}/api/telemetry`, { method: 'POST' })).status, 404)
  } finally {
    sockets.forEach((socket) => socket.disconnect())
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
  }
})
