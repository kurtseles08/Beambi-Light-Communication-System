import { useEffect, useRef } from 'react'

export const beepHz = (rssi: number) => 220 + (Math.min(100, Math.max(0, rssi)) / 100) * 1100

// Continuous tone whose pitch follows the signal. Silent when there is no light at all.
export function useBeep(enabled: boolean, rssi: number | null, volume: number) {
  const ctxRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)

  useEffect(() => {
    if (!enabled) return
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    gain.gain.value = 0
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    void ctx.resume()
    ctxRef.current = ctx
    oscRef.current = osc
    gainRef.current = gain
    return () => {
      osc.stop()
      void ctx.close()
      ctxRef.current = null
      oscRef.current = null
      gainRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    const ctx = ctxRef.current
    const osc = oscRef.current
    const gain = gainRef.current
    if (!enabled || !ctx || !osc || !gain || rssi === null) return
    osc.frequency.setTargetAtTime(beepHz(rssi), ctx.currentTime, 0.08)
    gain.gain.setTargetAtTime(rssi < 5 ? 0 : volume * 0.15, ctx.currentTime, 0.05)
  }, [enabled, rssi, volume])
}
