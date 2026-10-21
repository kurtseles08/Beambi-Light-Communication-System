import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from './dist/store.js'
import { createHardware } from './dist/hardware.js'

test('extended offline recording retains bounded history without queuing cloud writes', async () => {
  const previous = process.env.PERSIST_HISTORY
  process.env.PERSIST_HISTORY = 'false'
  const now = Date.now
  let clock = 100_000
  Date.now = () => clock
  const store = await createStore()
  try {
    const hw = createHardware()
    store.startRun(15, 'User-entered distance; offline bench run')
    for (let i = 0; i < 20_000; i++) {
      clock += 5000
      for (const unit of ['A', 'B']) hw.ingest({ unit, rssi: 60, laserOk: true, channel: 'FSO' })
      const { reading } = hw.step()
      store.addReading(reading)
      store.updateRun(reading)
      store.addEvent({ id: String(i), ts: clock, severity: 'Info', type: 'test', message: 'Offline report' })
    }
    assert.equal(store.persistence, 'memory')
    assert.deepEqual(store.pendingWrites(), { samples: 0, events: 0 })
    assert.equal(store.events.length, 500)
    const history = store.history(1440)
    assert.ok(history.length > 1 && history.length <= 360)
    assert.ok(history.every((r) => r.rssi === 60 && r.ts >= clock - 86400_000))
    const run = await store.stopRun()
    assert.equal(run.avgRssi, 60)
    assert.equal(run.samples, 20_000)
    assert.equal(run.lockedPct, 100)
    assert.equal(run.distanceM, 15)
    for (const key of ['pdr', 'avgSnr']) assert.equal(key in run, false)
    assert.deepEqual(Object.keys(history[0]).sort(), ['ch', 'rssi', 'state', 'ts'])
  } finally {
    store.dispose()
    Date.now = now
    if (previous === undefined) delete process.env.PERSIST_HISTORY
    else process.env.PERSIST_HISTORY = previous
  }
})
