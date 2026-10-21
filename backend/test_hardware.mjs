import test from 'node:test'
import assert from 'node:assert/strict'
import { createHardware } from './dist/hardware.js'

test('one reporting unit does not prove a two-way laser link', () => {
  const hw = createHardware()
  hw.ingest({ unit: 'A', rssi: 70, laserOk: true, channel: 'FSO' })
  const { reading } = hw.step()
  assert.equal(reading.units.A.online, true)
  assert.equal(reading.units.B.online, false)
  assert.equal(reading.fso.laserOk, false)
  assert.equal(reading.linkState, 'Searching')
})

test('both fresh receivers lock; an expired remote becomes offline', () => {
  const actualNow = Date.now
  let now = 100000
  Date.now = () => now
  try {
    const hw = createHardware()
    hw.ingest({ unit: 'A', rssi: 70, laserOk: true, channel: 'FSO' })
    hw.ingest({ unit: 'B', rssi: 60, laserOk: true, channel: 'FSO' })
    assert.equal(hw.step().reading.linkState, 'Locked')
    now += 6000
    hw.ingest({ unit: 'A', rssi: 70, laserOk: true, channel: 'FSO' })
    assert.equal(hw.step().reading.units.B.online, false)
    assert.equal(hw.step().reading.linkState, 'Searching')
    now += 6000
    assert.equal(hw.step(), null)
  } finally {
    Date.now = actualNow
  }
})

test('LoRa fallback has no synthetic voice, packet, or radio summary metrics', () => {
  const hw = createHardware()
  for (const unit of ['A', 'B'])
    hw.ingest({ unit, rssi: 20, laserOk: false, channel: 'RF', rfRssi: -80 })
  const { reading } = hw.step()
  assert.equal(reading.linkState, 'Failover')
  assert.equal(reading.fso.laserOk, false)
  for (const key of ['rf', 'ab', 'ba', 'env']) assert.equal(key in reading, false)
})

test('summary refresh does not renew the timestamp of an old hardware report', () => {
  const actualNow = Date.now
  let now = 100000
  Date.now = () => now
  try {
    const hw = createHardware()
    hw.ingest({ unit: 'A', rssi: 70, laserOk: true, channel: 'FSO' })
    now += 4000
    assert.equal(hw.step().reading.ts, 100000)
    now += 1000
    assert.equal(hw.step(), null)
  } finally {
    Date.now = actualNow
  }
})
