const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Same formula as backend/src/index.ts. 50 = exactly at the unit's failover threshold.
export const signalOf = (env: number, thr: number) =>
  clamp(50 + 50 * Math.log10(Math.max(env, 1e-4) / Math.max(thr, 1e-3)), 0, 100)