import { create } from 'zustand'
import { onVoiceRx, voiceChunk, voiceEnd, voiceStart } from './deviceStore'
import type { UnitId } from '../types'

const RATE = 8000 // matches the firmware sample rate
const FRAME = 160 // 20 ms of audio per packet

export type Clip = { id: string; ts: number; dir: 'tx' | 'rx'; unit: string; seconds: number; url: string }

type VoiceState = { armed: boolean; talking: boolean; level: number; error: string | null; clips: Clip[] }

export const useVoice = create<VoiceState>(() => ({
  armed: false,
  talking: false,
  level: 0,
  error: null,
  clips: [],
}))
const set = useVoice.setState

// Runs on the audio thread and hands raw mic frames to the page
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

// Averages mic samples down to 8 kHz
class Downsampler {
  private acc = 0
  private n = 0
  private pos = 0
  private ratio: number

  constructor(ratio: number) {
    this.ratio = ratio
  }
  push(input: Float32Array, out: number[]) {
    for (const x of input) {
      this.acc += x
      this.n++
      this.pos++
      if (this.pos >= this.ratio) {
        out.push(this.acc / this.n)
        this.acc = 0
        this.n = 0
        this.pos -= this.ratio
      }
    }
  }
}

type Runtime = { stream: MediaStream; ctx: AudioContext; node: AudioWorkletNode; down: Downsampler }
let rt: Runtime | null = null
let target: UnitId | null = null
let down: Downsampler | null = null
let pending: number[] = []
let sent: Int16Array[] = []
let lastLevel = 0

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

function toWav(chunks: Int16Array[], rate: number): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  let off = 44
  for (const c of chunks) for (const s of c) { v.setInt16(off, s, true); off += 2 }
  return new Blob([buf], { type: 'audio/wav' })
}

function addClip(dir: 'tx' | 'rx', unit: string, chunks: Int16Array[], rate: number) {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  if (n < rate * 0.2) return // ignore taps shorter than 0.2 s
  const clip: Clip = { id: uid(), ts: Date.now(), dir, unit, seconds: n / rate, url: URL.createObjectURL(toWav(chunks, rate)) }
  set((s) => {
    const clips = [clip, ...s.clips]
    clips.slice(20).forEach((c) => URL.revokeObjectURL(c.url))
    return { clips: clips.slice(0, 20) }
  })
}

function onFrame(f: Float32Array) {
  let sum = 0
  for (const x of f) sum += x * x
  const now = performance.now()
  if (now - lastLevel > 60) {
    lastLevel = now
    set({ level: Math.min(1, Math.sqrt(sum / f.length) * 4) })
  }
  if (!target || !down) return
  const out: number[] = []
  down.push(f, out)
  for (const x of out) pending.push(Math.round(Math.max(-1, Math.min(1, x)) * 32767))
  while (pending.length >= FRAME) {
    const chunk = Int16Array.from(pending.splice(0, FRAME))
    sent.push(chunk)
    voiceChunk(target, chunk.buffer)
  }
}

// Turn the laptop microphone on (asks for permission once). Nothing is sent until you talk.
export async function armMic() {
  if (rt) return
  if (!navigator.mediaDevices?.getUserMedia) {
    set({ error: 'The browser blocks the microphone here. Open the dashboard on localhost or over https.' })
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const ctx = new AudioContext()
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-capture')
    const mute = ctx.createGain()
    mute.gain.value = 0 // keeps the graph running without playing the mic back
    src.connect(node).connect(mute).connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data)
    rt = { stream, ctx, node, down: new Downsampler(ctx.sampleRate / RATE) }
    set({ armed: true, error: null })
  } catch (e) {
    set({
      error:
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in the browser address bar and try again.'
          : 'Could not start the microphone.',
    })
  }
}

export function disarmMic() {
  stopTalking()
  if (!rt) return
  rt.stream.getTracks().forEach((t) => t.stop())
  void rt.ctx.close()
  rt = null
  set({ armed: false, level: 0 })
}

export function startTalking(unit: UnitId) {
  if (!rt || target) return
  target = unit
  down = new Downsampler(rt.ctx.sampleRate / RATE)
  pending = []
  sent = []
  voiceStart(unit, RATE)
  set({ talking: true })
}

export function stopTalking() {
  if (!target) return
  if (pending.length) {
    const tail = Int16Array.from(pending)
    sent.push(tail)
    voiceChunk(target, tail.buffer)
  }
  voiceEnd(target)
  addClip('tx', target, sent, RATE)
  target = null
  down = null
  pending = []
  sent = []
  set({ talking: false })
}

// ---------- incoming voice from the hardware (played live and kept as a clip) ----------

let playCtx: AudioContext | null = null
let playAt = 0
const incoming = new Map<string, { chunks: Int16Array[]; rate: number }>()

function play(pcm: Int16Array, rate: number) {
  playCtx ??= new AudioContext()
  const ctx = playCtx
  if (ctx.state === 'suspended') void ctx.resume()
  const buf = ctx.createBuffer(1, pcm.length, rate)
  const ch = buf.getChannelData(0)
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  const t = Math.max(ctx.currentTime + 0.08, playAt)
  src.start(t)
  playAt = t + buf.duration
}

onVoiceRx((m) => {
  const rate = m.sampleRate ?? RATE
  const slot = incoming.get(m.from) ?? { chunks: [], rate }
  if (m.pcm && m.pcm.byteLength >= 2) {
    const pcm = new Int16Array(m.pcm.slice(0, m.pcm.byteLength - (m.pcm.byteLength % 2)))
    slot.chunks.push(pcm)
    slot.rate = rate
    incoming.set(m.from, slot)
    play(pcm, rate)
  }
  if (m.end) {
    addClip('rx', m.from, slot.chunks, slot.rate)
    incoming.delete(m.from)
  }
})