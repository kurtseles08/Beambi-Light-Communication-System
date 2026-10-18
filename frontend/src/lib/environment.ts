const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// How much of the clear-air signal is lost, in %
export const attenuationOf = (rssi: number, clearRssi: number) => clamp((1 - rssi / clearRssi) * 100, 0, 100)