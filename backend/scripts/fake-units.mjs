// Pretends to be unit A and unit B over Wi-Fi. Run from the backend folder: node scripts/fake-units.mjs
try { process.loadEnvFile('.env') } catch {}
const HOST = process.argv[2] || 'http://localhost:4000'
const KEY = process.env.DEVICE_KEY
if (!KEY) { console.error('Set DEVICE_KEY in backend/.env first'); process.exit(1) }

const post = async (o) => {
  try {
    const r = await fetch(`${HOST}/api/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify(o),
    })
    const j = await r.json()
    if (!r.ok) console.error('unit', o.unit, 'status', r.status, j)
    else if (j.cmds?.length) console.log('unit', o.unit, 'got commands:', JSON.stringify(j.cmds))
  } catch (e) { console.error('post failed:', e.message) }
}

let t = 0
const status = (unit, blocked) => {
  const thr = 0.1
  const env = blocked ? 0.01 : 0.25 + 0.1 * Math.sin(t / 3)
  const laser = env > thr ? 1 : 0
  const bat = Math.max(0, 4.15 - t * 0.0004 - (unit === 'B' ? 0.1 : 0))
  return {
    t: 'status', unit, up: t, laser, env, thr, mode: 0, failover: laser ? 0 : 1, tx: 4, rx: 0,
    vol: 0.6, rxGain: 8, micGain: 4, duck: 0, gate: 0, micP2P: 800, panP2P: 1400,
    workAvg: 40, workMax: 60, over: 0, cal: 0,
    lora: { ok: 1, peer: unit === 'A' ? 'B' : 'A', peerLaser: laser, ageS: 1, rssi: -70, snr: 8, tx: t, rx: t },
    batV: Number(bat.toFixed(2)), batPct: Math.max(0, Math.round(((bat - 3.3) / 0.9) * 100)),
  }
}

for (const u of ['A', 'B']) await post({ t: 'hello', unit: u, fw: 'fake' })
setInterval(() => {
  t++
  const blocked = t % 60 >= 50 // beam blocked for 10 s out of every 60
  post(status('A', blocked))
  post(status('B', blocked))
}, 1000)
console.log('Sending fake reports for units A and B. Ctrl+C to stop.')