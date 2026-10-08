import type { Channel, Direction, LinkEvent, LinkState, Reading, Severity } from './types.js'

type Scenario = 'clear' | 'fog' | 'obstruction'

const FAIL_BELOW = 30 // failover when signal stays below this
const LOCK_ABOVE = 50 // "Locked" at or above this; also the recovery level
const AUTO =
  (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.SIM_AUTO !== 'false' // set SIM_AUTO=false to stop random events

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const noise = (amp: number) => (Math.random() * 2 - 1) * amp
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

export function createSimulator() {
  const startTs = Date.now()
  let tick = 0
  let scenario: Scenario = 'clear'
  let scenarioEndsAt = 0
  let nextAuto = randInt(45, 75)
  let fogLevel = 0

  let channel: Channel = 'RF'
  let state: LinkState = 'Searching'
  let lowTicks = 0
  let goodTicks = 0
  let reacqTicks = 0

  let failovers = 0
  let lastFailoverTs: number | null = null
  let lastFailoverReason: string | null = null
  let retransmissions = 0
  let batteryA = 92
  let batteryB = 88
  let eventId = 0

  function lossFor(sig: number) {
    return sig >= LOCK_ABOVE ? Math.random() * 0.3 : clamp((LOCK_ABOVE - sig) * 2, 0, 100)
  }

  function step() {
    tick++
    const ts = Date.now()
    const newEvents: LinkEvent[] = []
    const addEvent = (severity: Severity, type: string, message: string) =>
      newEvents.push({ id: ++eventId, ts, severity, type, message })

    if (tick === 1) addEvent('Info', 'system', 'Simulator started')

    // Scenarios: random events for demos (or injected manually)
    if (AUTO && scenario === 'clear' && tick >= nextAuto) {
      if (Math.random() < 0.6) {
        scenario = 'obstruction'
        scenarioEndsAt = tick + randInt(8, 14)
      } else {
        scenario = 'fog'
        scenarioEndsAt = tick + randInt(40, 70)
      }
    }
    if (scenario !== 'clear' && tick >= scenarioEndsAt) {
      scenario = 'clear'
      nextAuto = tick + randInt(45, 75)
    }

    // FSO signal strength (0-100). Fog is gradual, obstruction is sudden.
    fogLevel += clamp((scenario === 'fog' ? 0.9 : 0) - fogLevel, -0.04, 0.04)
    let signal = (82 + 6 * Math.sin(tick / 14) + noise(2)) * (1 - 0.85 * fogLevel)
    if (scenario === 'obstruction') signal = 3 + Math.random() * 3
    signal = clamp(signal, 0, 100)

    // Link state machine with hysteresis
    const prevState = state
    if (tick <= 3) {
      state = 'Searching'
      channel = 'RF'
    } else if (tick === 4) {
      channel = 'FSO'
      state = 'Locked'
      addEvent('Info', 'link-up', 'Link locked on FSO')
    } else if (channel === 'FSO') {
      lowTicks = signal < FAIL_BELOW ? lowTicks + 1 : 0
      if (lowTicks >= 2) {
        const reason =
          scenario === 'obstruction'
            ? 'Beam obstruction'
            : scenario === 'fog'
              ? 'Weather attenuation (fog)'
              : 'Low signal (possible misalignment)'
        channel = 'RF'
        state = 'Failover'
        failovers++
        lastFailoverTs = ts
        lastFailoverReason = reason
        lowTicks = 0
        goodTicks = 0
        addEvent('Warning', 'failover', `Failover to RF: ${reason}`)
      } else {
        state = signal >= LOCK_ABOVE ? 'Locked' : 'Degraded'
      }
    } else if (state === 'Re-acquiring') {
      if (signal < LOCK_ABOVE) {
        state = 'Failover'
        goodTicks = 0
      } else if (++reacqTicks >= 3) {
        channel = 'FSO'
        state = 'Locked'
        addEvent('Info', 'recovered', 'FSO restored, back to optical link')
      }
    } else {
      state = 'Failover'
      goodTicks = signal > LOCK_ABOVE ? goodTicks + 1 : 0
      if (goodTicks >= 5) {
        state = 'Re-acquiring'
        reacqTicks = 0
      }
    }
    if (state === 'Degraded' && prevState !== 'Degraded')
      addEvent('Warning', 'degraded', 'FSO signal degraded')

    // FSO metrics
    const berPre = clamp(Math.pow(10, -(signal / 12) - 0.5), 1e-9, 0.5)
    const fso = {
      rssi: r1(signal),
      snr: r1(clamp(signal * 0.3 - 2 + noise(0.8), -5, 30)),
      berPre,
      berPost: berPre < 0.01 ? berPre * 1e-3 : berPre * 0.8,
      frameLoss: r1(lossFor(signal)),
      laserOk: true,
      rxPresent: signal > 5,
      ambientLux: Math.round(400 + 250 * Math.sin(tick / 60) + noise(20)),
    }

    // RF metrics (not affected by fog or beam blockage)
    const onFso = channel === 'FSO'
    if (!onFso && Math.random() < 0.15) retransmissions++
    const rfRssi = r1(-88 + noise(3))
    const rf = {
      rssi: rfRssi,
      snr: r1(7 + noise(1.5)),
      channel: randInt(0, 7),
      hopSync: Math.random() > 0.01,
      retransmissions,
      codec: onFso ? 'PCM 64 kbps' : 'ADPCM 12 kbps',
      encrypted: true,
    }

    // A->B and B->A are independent paths
    const direction = (sig: number): Direction => {
      const loss = onFso ? lossFor(sig) : 1 + Math.random()
      const rate = onFso ? 64 : 12
      return {
        connected: onFso ? sig >= 20 : rfRssi > -115,
        bitrateKbps: r1(Math.max(0, rate * (1 - loss / 100) + noise(0.5))),
        latencyMs: Math.round((onFso ? 22 : 150) + noise(onFso ? 4 : 25)),
        jitterMs: r1(Math.abs(2 + noise(1))),
        packetLoss: r1(loss),
      }
    }

    batteryA = Math.max(0, batteryA - 0.012)
    batteryB = Math.max(0, batteryB - 0.008)

    const reading: Reading = {
      ts,
      activeChannel: channel,
      linkState: state,
      fso,
      rf,
      ab: direction(signal),
      ba: direction(clamp(signal + noise(4), 0, 100)),
      units: {
        A: { online: true, battery: r1(batteryA), voltage: r2(6.4 + batteryA * 0.026) },
        B: { online: true, battery: r1(batteryB), voltage: r2(6.4 + batteryB * 0.026) },
      },
      session: {
        uptimeSec: Math.floor((ts - startTs) / 1000),
        failovers,
        lastFailoverTs,
        lastFailoverReason,
      },
    }
    return { reading, newEvents }
  }

  // Manual control for demo mode
  function inject(kind: unknown) {
    if (kind === 'fog') {
      scenario = 'fog'
      scenarioEndsAt = Infinity
    } else if (kind === 'obstruction') {
      scenario = 'obstruction'
      scenarioEndsAt = tick + 12
    } else if (kind === 'clear') {
      scenario = 'clear'
      nextAuto = tick + randInt(45, 75)
    }
  }

  return { step, inject }
}