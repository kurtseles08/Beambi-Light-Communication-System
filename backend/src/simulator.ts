import { randomUUID } from 'node:crypto'
import { createVoice } from './voice.js'
import type {
  AimCommand, Channel, Direction, Inject, LinkEvent, LinkState, PacketRecord, Reading, Settings, Severity,
} from './types.js'

export type Scenario = 'clear' | 'fog' | 'dust' | 'obstruction' | 'glare' | 'lossburst' | 'drift'

const BASE_RSSI = 82 // what the simulated optics deliver in clear air
const AIM_SIGMA = 2 // steps. At 2 steps off target the signal is about 60% of its best (same value in the frontend)
const FRAME = {
  FSO: { perTick: 25, size: 256, kbps: 64 },
  RF: { perTick: 6, size: 48, kbps: 12 },
}
const MODE_LABEL = { auto: 'Auto', fso: 'Force FSO', rf: 'Force RF' } as const

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const noise = (amp: number) => (Math.random() * 2 - 1) * amp
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

type Counters = { sent: number; recv: number; lost: number; bytes: number; seq: number }
const freshCounters = (): Counters => ({ sent: 0, recv: 0, lost: 0, bytes: 0, seq: 0 })

export function createSimulator(getSettings: () => Settings) {
  const startTs = Date.now()
  let tick = 0

  let scenario: Scenario = 'clear'
  let scenarioEndsAt = 0
  let nextAuto = randInt(45, 75)
  let atten = 0 // 0..1 gradual attenuation (fog, dust)
  let glare = 0 // 0..1 strong ambient light
  let manual = { pan: 0, tilt: 0 } // mount offset set by the operator, in steps
  let driftAmt = 0 // extra offset that builds slowly during the drift scenario
  let driftAngle = 0
  const pendingNotes: { severity: Severity; type: string; message: string }[] = []
  let humidity = 68

  let channel: Channel = 'RF'
  let state: LinkState = 'Searching'
  let prevMode = getSettings().mode
  let lowTicks = 0
  let goodTicks = 0
  let reacqTicks = 0

  let failovers = 0
  let lastFailoverTs: number | null = null
  let lastFailoverReason: string | null = null
  let retransmissions = 0
  let batteryA = 92
  let batteryB = 88
  const batteryFlag = { A: 0, B: 0 } // 0 ok, 1 low, 2 critical
  let interrupted = false
  let interruptedAt = 0
  let glareFlagged = false
  let failedDecryptions = 0
  const tamperUntil = { A: 0, B: 0 }
  const pendingTamper: ('A' | 'B')[] = []
  const dirs = { ab: freshCounters(), ba: freshCounters() }
  const voice = createVoice()

  function begin(next: Scenario, endsAt: number) {
    scenario = next
    scenarioEndsAt = endsAt
    if (next === 'drift') driftAngle = Math.random() * Math.PI * 2
  }
  const start = (next: Scenario, duration: number) => begin(next, tick + duration)

  function step() {
    tick++
    const ts = Date.now()
    const s = getSettings()
    const events: LinkEvent[] = []
    const packets: PacketRecord[] = []
    const addEvent = (severity: Severity, type: string, message: string, extra: Partial<LinkEvent> = {}) =>
      events.push({ id: randomUUID(), ts, severity, type, message, ...extra })

    if (tick === 1) addEvent('Info', 'system', 'Simulator started')
    for (const n of pendingNotes.splice(0)) addEvent(n.severity, n.type, n.message)

    if (s.mode !== prevMode) {
      addEvent('Info', 'mode', `Operating mode set to ${MODE_LABEL[s.mode]}`)
      prevMode = s.mode
      lowTicks = 0
      goodTicks = 0
    }

    // --- Scenarios: random ones for demos, or injected from Settings
    if (s.autoScenarios && scenario === 'clear' && tick >= nextAuto) {
      const r = Math.random()
      if (r < 0.3) start('obstruction', randInt(8, 14))
      else if (r < 0.5) start('glare', randInt(25, 40))
      else if (r < 0.7) start('fog', randInt(40, 70))
      else if (r < 0.85) start('dust', randInt(30, 50))
      else start('drift', randInt(55, 75))
    }
    if (scenario !== 'clear' && tick >= scenarioEndsAt) {
      scenario = 'clear'
      nextAuto = tick + randInt(45, 75)
    }

    atten += clamp((scenario === 'fog' ? 0.85 : scenario === 'dust' ? 0.45 : 0) - atten, -0.04, 0.04)
    glare += clamp((scenario === 'glare' ? 1 : 0) - glare, -0.12, 0.12)
    // The mount drifts off target slowly (about 0.05 step per second) and snaps back once cleared
    driftAmt += clamp((scenario === 'drift' ? 3 : 0) - driftAmt, -0.15, 0.05)
    const pan = manual.pan + Math.cos(driftAngle) * driftAmt
    const tilt = manual.tilt + Math.sin(driftAngle) * driftAmt
    // Beam pointing: full signal on target, falling off smoothly as the aim moves away
    const aimGain = Math.exp(-(pan * pan + tilt * tilt) / (2 * AIM_SIGMA * AIM_SIGMA))
    // A big solar panel collects much more stray light than a small photodiode
    const g = glare * (s.receiver === 'solar-panel' ? 1 : 0.4)

    // --- Optical signal. Fog is gradual, obstruction is sudden, glare adds noise.
    let signal = (BASE_RSSI + 6 * Math.sin(tick / 14) + noise(2 + 9 * g)) * (1 - atten) * (1 - 0.12 * g) * aimGain
    if (scenario === 'obstruction') signal = 3 + Math.random() * 3
    signal = clamp(signal, 0, 100)

    const lux = Math.max(0, 800 + 500 * Math.sin(tick / 90) + glare * (65000 + noise(8000)) + noise(30))
    const burst = scenario === 'lossburst' ? 35 + Math.random() * 35 : 0
    const baseLoss = signal >= s.lockAbove ? Math.random() * 0.3 : clamp((s.lockAbove - signal) * 2, 0, 100)
    const fsoLoss = clamp(baseLoss + g * 40 * (0.6 + 0.4 * Math.random()) + burst, 0, 100)
    const snr = clamp(signal * 0.3 - 2 + noise(0.8) - 12 * g, -5, 30)

    // --- Beam interruption and light events
    if (!interrupted && signal < 8) {
      interrupted = true
      interruptedAt = ts
      addEvent('Warning', 'beam-interruption', 'Beam interrupted: optical signal lost')
    } else if (interrupted && signal >= 20) {
      interrupted = false
      const d = Math.round((ts - interruptedAt) / 1000)
      addEvent('Info', 'beam-restored', `Beam restored after ${d} s`, { durationSec: d })
    }
    if (lux >= s.ambientWarnLux && !glareFlagged) {
      glareFlagged = true
      addEvent(
        lux >= s.ambientCritLux ? 'Critical' : 'Warning',
        'ambient-light',
        `High ambient light: ${Math.round(lux).toLocaleString('en-US')} lx can disturb the receiver`,
      )
    } else if (lux < s.ambientWarnLux * 0.6) glareFlagged = false

    // --- Link state machine (hysteresis comes from the two thresholds and hold times)
    const failReason = () =>
      scenario === 'obstruction' ? 'Beam obstruction'
        : scenario === 'fog' ? 'Weather attenuation (fog)'
          : scenario === 'dust' ? 'Atmospheric attenuation (dust or haze)'
            : scenario === 'glare' ? 'Strong ambient light interference'
              : scenario === 'lossburst' ? 'Packet-loss burst'
                : scenario === 'drift' ? 'Beam drift (misalignment)'
                  : aimGain < 0.7 ? 'Mount out of alignment' : signal < s.failBelow ? 'Low signal (possible misalignment)' : 'High frame loss'
    const bad = signal < s.failBelow || fsoLoss > s.maxFrameLoss
    const healthy = signal > s.lockAbove && fsoLoss <= s.maxFrameLoss / 2

    const prevState = state
    if (s.mode === 'rf') {
      channel = 'RF'
      state = 'Failover'
      lowTicks = 0
      goodTicks = 0
    } else if (s.mode === 'fso') {
      channel = 'FSO'
      state = signal >= s.lockAbove ? 'Locked' : signal >= s.failBelow ? 'Degraded' : 'Searching'
    } else if (tick <= 3) {
      state = 'Searching'
      channel = 'RF'
    } else if (tick === 4) {
      channel = 'FSO'
      state = 'Locked'
      addEvent('Info', 'link-up', 'Link locked on FSO')
    } else if (channel === 'FSO') {
      lowTicks = bad ? lowTicks + 1 : 0
      if (lowTicks >= s.failDelaySec) {
        const reason = failReason()
        channel = 'RF'
        state = 'Failover'
        failovers++
        lastFailoverTs = ts
        lastFailoverReason = reason
        lowTicks = 0
        goodTicks = 0
        addEvent('Warning', 'failover', `Failover to RF: ${reason}`)
      } else {
        // 3-point margin so the label does not flicker while the signal sits on the threshold
        const lockLevel = state === 'Locked' ? s.lockAbove - 3 : s.lockAbove
        state = signal >= lockLevel && fsoLoss <= s.maxFrameLoss ? 'Locked' : 'Degraded'
      }
    } else if (state === 'Re-acquiring') {
      if (!healthy) {
        state = 'Failover'
        goodTicks = 0
      } else if (++reacqTicks >= 3) {
        channel = 'FSO'
        state = 'Locked'
        addEvent('Info', 'recovered', 'FSO restored, back on the optical link')
      }
    } else {
      state = 'Failover'
      goodTicks = healthy ? goodTicks + 1 : 0
      if (goodTicks >= s.recoverHoldSec) {
        state = 'Re-acquiring'
        reacqTicks = 0
      }
    }
    if (state === 'Degraded' && prevState !== 'Degraded' && s.mode === 'auto') {
      addEvent('Warning', 'degraded', 'FSO signal degraded')
    }

    // --- Metrics per channel
    const onFso = channel === 'FSO'
    const fr = onFso ? FRAME.FSO : FRAME.RF
    if (!onFso && Math.random() < 0.15) retransmissions++

    const berPre = clamp(Math.pow(10, -(signal / 12) - 0.5) * (1 + 40 * g), 1e-9, 0.5)
    const rfRssi = r1(-88 + noise(3))

    const direction = (key: 'ab' | 'ba', sig: number, label: PacketRecord['dir']): Direction => {
      const loss = onFso ? clamp(fsoLoss + (key === 'ba' ? noise(2) : 0), 0, 100) : 1 + Math.random()
      const c = dirs[key]
      const lost = clamp(Math.round((fr.perTick * loss) / 100 + (Math.random() - 0.5)), 0, fr.perTick)
      c.sent += fr.perTick
      c.lost += lost
      c.recv += fr.perTick - lost
      c.bytes += (fr.perTick - lost) * fr.size
      c.seq += fr.perTick

      // One representative frame per second goes in the packet log
      const roll = Math.random() * 100
      const fec = onFso ? clamp((s.lockAbove - sig) * 0.6 + 3, 2, 40) : 3
      const status: PacketRecord['status'] = roll < loss ? 'Lost' : roll < loss + fec ? 'Corrected' : 'Delivered'
      packets.push({
        id: randomUUID(), ts, dir: label, channel, seq: c.seq, size: fr.size,
        crc: status === 'Lost' ? '—' : status === 'Corrected' ? 'FEC corrected' : 'OK',
        status,
      })
      return {
        connected: onFso ? sig >= 20 : rfRssi > -115,
        bitrateKbps: r1(Math.max(0, fr.kbps * (1 - loss / 100) + noise(0.5))),
        latencyMs: Math.round((onFso ? 22 : 150) + noise(onFso ? 4 : 25)),
        jitterMs: r1(Math.abs(2 + noise(1) + g * 6)),
        packetLoss: r1(loss),
        framesSent: c.sent, framesReceived: c.recv, framesLost: c.lost, bytes: c.bytes,
      }
    }
    const ab = direction('ab', signal, 'A→B')
    const ba = direction('ba', clamp(signal + noise(4), 0, 100), 'B→A')

    // --- Security: light interference and heavy attenuation corrupt frames
    const addFailed = (n: number) => {
      const before = failedDecryptions
      failedDecryptions += n
      if (Math.floor(failedDecryptions / 10) > Math.floor(before / 10)) {
        addEvent('Warning', 'decrypt-fail', `${failedDecryptions} frames have failed decryption this session`)
      }
    }
    const pFail = 0.01 + g * 0.3 + (atten > 0.5 ? 0.05 : 0) + (scenario === 'lossburst' ? 0.1 : 0)
    if (Math.random() < pFail) addFailed(1)

    // Voice messages between the units: only what passes the encryption check becomes a message
    const talk = voice.step({
      tick, ts, channel, rssi: signal, snr, lossAB: ab.packetLoss, lossBA: ba.packetLoss,
      latAB: ab.latencyMs, latBA: ba.latencyMs,
      repairRate: (onFso ? clamp((s.lockAbove - signal) * 0.6 + 3, 2, 40) : 3) / 100,
      cipher: 'AES-256-GCM',
    })
    if (talk.failedFrames) addFailed(talk.failedFrames)
    for (const f of talk.filtered) if (f.kind === 'stutter') addEvent('Warning', 'message-rejected', f.detail)
    if (s.autoScenarios && Math.random() < 1 / 500) pendingTamper.push(Math.random() < 0.5 ? 'A' : 'B')
    for (const unit of pendingTamper.splice(0)) {
      tamperUntil[unit] = tick + 20
      addEvent('Critical', 'tamper', `Tamper detected on Unit ${unit}: enclosure opened`, { unit })
    }

    // --- Batteries and environment sensors
    batteryA = Math.max(0, batteryA - 0.012)
    batteryB = Math.max(0, batteryB - 0.008)
    for (const [name, pct] of [['A', batteryA], ['B', batteryB]] as const) {
      if (pct <= s.critBatteryPct && batteryFlag[name] < 2) {
        batteryFlag[name] = 2
        addEvent('Critical', 'battery', `Unit ${name} battery critical (${pct.toFixed(0)}%)`, { unit: name })
      } else if (pct <= s.lowBatteryPct && batteryFlag[name] < 1) {
        batteryFlag[name] = 1
        addEvent('Warning', 'battery', `Unit ${name} battery low (${pct.toFixed(0)}%)`, { unit: name })
      }
    }
    humidity += clamp((scenario === 'fog' ? 96 : scenario === 'dust' ? 50 : 68) - humidity, -0.5, 0.5)

    const unit = (name: 'A' | 'B', pct: number) => ({
      online: true, battery: r1(pct), voltage: r2(6.4 + pct * 0.026), tamper: tick < tamperUntil[name],
    })

    const reading: Reading = {
      ts,
      mode: s.mode,
      activeChannel: channel,
      linkState: state,
      fso: {
        rssi: r1(signal), snr: r1(snr), berPre,
        berPost: berPre < 0.01 ? berPre * 1e-3 : berPre * 0.8,
        frameLoss: r1(fsoLoss), laserOk: true, rxPresent: signal > 5, ambientLux: Math.round(lux),
      },
      rf: {
        rssi: rfRssi, snr: r1(7 + noise(1.5)), channel: randInt(0, 7), hopSync: Math.random() > 0.01,
        retransmissions, codec: onFso ? 'PCM 64 kbps' : 'ADPCM 12 kbps', encrypted: true,
      },
      ab, ba,
      units: { A: unit('A', batteryA), B: unit('B', batteryB) },
      env: {
        temperatureC: r1(30 + 2 * Math.sin(tick / 300) + noise(0.1)),
        humidityPct: r1(clamp(humidity + noise(0.4), 0, 100)),
      },
      aim: { pan: r2(pan), tilt: r2(tilt) },
      security: {
        cipher: 'AES-256-GCM', fsoEncrypted: true, rfEncrypted: true,
        failedDecryptions, framesAuthenticated: dirs.ab.recv + dirs.ba.recv,
      },
      session: { uptimeSec: Math.floor((ts - startTs) / 1000), failovers, lastFailoverTs, lastFailoverReason },
    }
    return { reading, events, packets, scenario, messages: talk.messages, filtered: talk.filtered }
  }

  // Demo controls
  function inject(kind: Inject | unknown) {
    switch (kind) {
      case 'fog': scenario = 'fog'; scenarioEndsAt = Infinity; break
      case 'dust': scenario = 'dust'; scenarioEndsAt = Infinity; break
      case 'glare': scenario = 'glare'; scenarioEndsAt = Infinity; break
      case 'obstruction': start('obstruction', 12); break
      case 'lossburst': start('lossburst', 15); break
      case 'drift': begin('drift', Infinity); break
      case 'clear': scenario = 'clear'; nextAuto = tick + randInt(45, 75); break
      case 'tamper': pendingTamper.push(Math.random() < 0.5 ? 'A' : 'B'); break
      case 'message': voice.trigger('message'); break
      case 'noise': voice.trigger('noise'); break
      case 'stutter': voice.trigger('stutter'); break
      case 'lowbattery': {
        const s = getSettings()
        batteryA = s.lowBatteryPct - 0.05 // just under the warning level, so the alert fires on the next tick
        batteryFlag.A = 0
        break
      }
    }
  }

  // Alignment practice: nudge, re-center, or knock the mount off target
  function aim(cmd: AimCommand) {
    const lim = (v: number) => clamp(v, -6, 6)
    if (cmd.reset) {
      manual = { pan: 0, tilt: 0 }
      pendingNotes.push({ severity: 'Info', type: 'aim', message: 'Mount re-centered (simulated)' })
    } else if (cmd.bump) {
      const a = Math.random() * Math.PI * 2
      const m = 1.8 + Math.random() * 0.8
      manual = { pan: lim(manual.pan + Math.cos(a) * m), tilt: lim(manual.tilt + Math.sin(a) * m) }
      pendingNotes.push({ severity: 'Warning', type: 'aim', message: 'Mount knocked out of alignment (simulated)' })
    } else {
      manual = {
        pan: lim(manual.pan + clamp(Number(cmd.dPan) || 0, -1, 1)),
        tilt: lim(manual.tilt + clamp(Number(cmd.dTilt) || 0, -1, 1)),
      }
    }
  }

  return { step, inject, aim }
}
