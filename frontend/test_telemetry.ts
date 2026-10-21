import test from 'node:test'
import assert from 'node:assert/strict'
import { isFresh, recentReadings } from './src/lib/freshness'
import { coach, evaluateAlignment } from './src/lib/alignment'
import type { Reading } from './src/types'

const reading = (ts: number, rssi: number) => ({ ts, fso: { rssi } }) as Reading

test('expired and disconnected telemetry never counts as live', () => {
  assert.equal(isFresh({ ts: 1000 }, true, 5999), true)
  assert.equal(isFresh({ ts: 1000 }, true, 6000), false)
  assert.equal(isFresh({ ts: 1000 }, false, 1001), false)
  assert.equal(isFresh(null, true, 1001), false)
  assert.equal(isFresh({ ts: 1500 }, true, 1000), true) // report arrived after the UI clock tick
})

test('alignment uses timestamps across gaps and gives signal-only advice', () => {
  const readings = [reading(1000, 99), reading(70_000, 50), reading(72_000, 52), reading(74_000, 54)]
  assert.equal(recentReadings(readings, 60).length, 3)
  const a = evaluateAlignment(readings, { failBelow: 42, lockAbove: 50 })!
  assert.equal(a.peak, 54)
  assert.equal(a.slopePer10s, 10)
  assert.equal(a.trend, 'rising')
  assert.equal(coach(a).title, 'Signal rising')
})
