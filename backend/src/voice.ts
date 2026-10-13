import { randomUUID } from 'node:crypto'
import type { Channel, FilteredEvent, MessageRecord, UnitId } from './types.js'

// Voice traffic between the two units. Simulated until real hardware reports it.
const PHRASES = [
  'Unit A to Unit B, radio check, how do you copy?',
  'Copy loud and clear, standing by for further instructions.',
  'Water level is rising near the east bridge, requesting a status update.',
  'Medical team arriving in ten minutes, please clear the road.',
  'Power is out in the northern district, the generator is running.',
  'Evacuation center reports sixty families checked in so far.',
  'Weather update, heavy rain expected within the hour.',
  'All teams report safe, no injuries so far.',
  'Requesting relay to command, the road to the harbor is blocked.',
  'Roger, message received, will pass it on to the team.',
  'Battery levels are good, the link is stable on laser.',
  'Fog is thickening, we may lose the laser link soon.',
  'Supplies have reached the school, distribution starts at noon.',
  'Please confirm the landing area is clear of debris.',
]

const FRAMES_PER_SEC = 4
const WORDS_PER_SEC = 2.5
const ACCEPT_MIN = 60 // % of frames that must pass the encryption check for a message to be accepted

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const r1 = (v: number) => Math.round(v * 10) / 10
const other = (u: UnitId): UnitId => (u === 'A' ? 'B' : 'A')

export type VoiceInput = {
  tick: number
  ts: number
  channel: Channel
  rssi: number
  snr: number
  lossAB: number // % of frames lost on each path
  lossBA: number
  latAB: number
  latBA: number
  repairRate: number // 0..1, chance that a received frame needed error correction
  cipher: string
}

export type VoiceOutput = { messages: MessageRecord[]; filtered: FilteredEvent[]; failedFrames: number }

type Tx = {
  from: UnitId
  to: UnitId
  words: string[]
  endsAt: number
  durationSec: number
  forcedLoss: number // % extra loss for the stuttered-voice demo, 0 otherwise
  frames: number
  lost: number
  repaired: number
  sumRssi: number
  sumSnr: number
  sumLat: number
  ticks: number
  fsoTicks: number
}

export function createVoice() {
  let seq = 0
  let tx: Tx | null = null
  let nextTx = rand(6, 12)
  const nextAmbient: Record<UnitId, number> = { A: rand(25, 60), B: rand(35, 80) }
  const manual: ('message' | 'noise' | 'stutter')[] = []

  function begin(tick: number, from: UnitId, forcedLoss = 0) {
    const words = PHRASES[rand(0, PHRASES.length - 1)].split(' ')
    const durationSec = Math.max(3, Math.round(words.length / WORDS_PER_SEC))
    tx = {
      from, to: other(from), words, endsAt: tick + durationSec, durationSec, forcedLoss,
      frames: 0, lost: 0, repaired: 0, sumRssi: 0, sumSnr: 0, sumLat: 0, ticks: 0, fsoTicks: 0,
    }
  }

  const ambient = (i: VoiceInput, unit: UnitId): FilteredEvent => ({
    id: randomUUID(), ts: i.ts, to: unit, kind: 'ambient',
    detail: `Background sound near Unit ${unit} ignored: no valid encrypted frames`,
  })

  function step(i: VoiceInput): VoiceOutput {
    const out: VoiceOutput = { messages: [], filtered: [], failedFrames: 0 }

    for (const m of manual.splice(0)) {
      if (m === 'message' && !tx) begin(i.tick, Math.random() < 0.5 ? 'A' : 'B')
      if (m === 'stutter' && !tx) begin(i.tick, Math.random() < 0.5 ? 'A' : 'B', 55 + rand(0, 20))
      if (m === 'noise') out.filtered.push(ambient(i, Math.random() < 0.5 ? 'A' : 'B'))
    }
    if (!tx && i.tick >= nextTx) begin(i.tick, Math.random() < 0.5 ? 'A' : 'B')

    if (tx) {
      const loss = Math.max(tx.forcedLoss, tx.from === 'A' ? i.lossAB : i.lossBA)
      for (let k = 0; k < FRAMES_PER_SEC; k++) {
        tx.frames++
        if (Math.random() * 100 < loss) tx.lost++
        else if (Math.random() < i.repairRate) tx.repaired++
      }
      tx.sumRssi += i.rssi
      tx.sumSnr += i.snr
      tx.sumLat += tx.from === 'A' ? i.latAB : i.latBA
      tx.ticks++
      if (i.channel === 'FSO') tx.fsoTicks++

      if (i.tick >= tx.endsAt) {
        const accuracy = ((tx.frames - tx.lost) / tx.frames) * 100
        if (accuracy < ACCEPT_MIN) {
          // Stuttered audio: too few frames pass the check, so nothing is shown as a message
          out.filtered.push({
            id: randomUUID(), ts: i.ts, to: tx.to, kind: 'stutter',
            detail: `Stuttered audio from Unit ${tx.from} rejected: only ${accuracy.toFixed(0)}% of frames passed the encryption check`,
          })
          out.failedFrames += tx.lost
        } else {
          // The gaps match the accuracy: lost frames become missing words
          const n = Math.min(tx.words.length - 1, Math.ceil((tx.lost / tx.frames) * tx.words.length))
          const missing = new Set<number>()
          while (missing.size < n) missing.add(rand(0, tx.words.length - 1))
          const heard: string[] = []
          tx.words.forEach((w, idx) => {
            const word = missing.has(idx) ? '···' : w
            if (!(word === '···' && heard[heard.length - 1] === '···')) heard.push(word)
          })
          out.messages.push({
            id: randomUUID(), seq: ++seq, ts: i.ts, from: tx.from, to: tx.to,
            channel: tx.fsoTicks >= tx.ticks / 2 ? 'FSO' : 'RF',
            durationSec: tx.durationSec, text: heard.join(' '), accuracy: r1(accuracy),
            frames: tx.frames, repaired: tx.repaired, lost: tx.lost,
            rssi: r1(tx.sumRssi / tx.ticks), snr: r1(tx.sumSnr / tx.ticks),
            latencyMs: Math.round(tx.sumLat / tx.ticks), cipher: i.cipher,
          })
        }
        tx = null
        nextTx = i.tick + rand(12, 28)
      }
    }

    // Random background sound near a unit. It never becomes a message.
    for (const u of ['A', 'B'] as const) {
      if (i.tick >= nextAmbient[u]) {
        nextAmbient[u] = i.tick + rand(40, 90)
        out.filtered.push(ambient(i, u))
      }
    }
    return out
  }

  return { step, trigger: (k: 'message' | 'noise' | 'stutter') => manual.push(k) }
}
