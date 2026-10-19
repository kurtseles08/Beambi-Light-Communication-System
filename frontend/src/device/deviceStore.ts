import { create } from "zustand";
import { io } from "socket.io-client";
import { BACKEND_URL } from "../store/link";
import type { DeviceCommand, DeviceStatus, LoraMessage, PongRecord, UnitId } from "../types";

const TOKEN: string = import.meta.env.VITE_COMMAND_TOKEN ?? "";

type PerUnit<T> = Record<UnitId, T>;
export type CommandTarget = UnitId | "both";

type DeviceState = {
  backendUp: boolean;
  device: DeviceStatus | null; // the unit the backend calls SHOWN_UNIT (Home and Link Details)
  deviceConnected: boolean;
  devices: PerUnit<DeviceStatus | null>; // both units, for the Hardware page
  unitsOnline: PerUnit<boolean>;
  selected: UnitId;
  applyBoth: boolean;
  canCommand: boolean;
  loraLog: LoraMessage[];
  pongs: PongRecord[];
  lastError: string | null;
};

type InitPayload = {
  device?: DeviceStatus | null;
  deviceConnected?: boolean;
  devices?: PerUnit<DeviceStatus | null>;
  unitsOnline?: PerUnit<boolean>;
  canCommand?: boolean;
  loraLog?: LoraMessage[];
  pongs?: PongRecord[];
};

export const useDevice = create<DeviceState>(() => ({
  backendUp: false,
  device: null,
  deviceConnected: false,
  devices: { A: null, B: null },
  unitsOnline: { A: false, B: false },
  selected: "A",
  applyBoth: true,
  canCommand: false,
  loraLog: [],
  pongs: [],
  lastError: null,
}));

const socket = io(BACKEND_URL, { auth: { token: TOKEN } });
const set = useDevice.setState;

socket.on("connect", () => set({ backendUp: true }));
socket.on("disconnect", () => set({ backendUp: false }));
socket.on("init", (p: InitPayload) =>
  set({
    device: p.device ?? null,
    deviceConnected: !!p.deviceConnected,
    devices: p.devices ?? { A: null, B: null },
    unitsOnline: p.unitsOnline ?? { A: false, B: false },
    canCommand: !!p.canCommand,
    loraLog: p.loraLog ?? [],
    pongs: p.pongs ?? [],
  }),
);
socket.on("device", (d: DeviceStatus) => set({ device: d }));
socket.on("devices", (d: PerUnit<DeviceStatus | null>) => set({ devices: d }));
socket.on("devices:online", (u: PerUnit<boolean>) => set({ unitsOnline: u }));
socket.on("device:connection", (c: boolean) =>
  set(c ? { deviceConnected: true } : { deviceConnected: false, device: null }),
);
socket.on("lora:msg", (m: LoraMessage) =>
  set((s) => ({ loraLog: [...s.loraLog, m].slice(-100) })),
);
socket.on("lora:pong", (p: PongRecord) =>
  set((s) => ({ pongs: [...s.pongs, p].slice(-100) })),
);
socket.on("device:ack", (a: { ok: boolean; error?: string }) =>
  set({ lastError: a.ok ? null : (a.error ?? "failed") }),
);

export const selectUnit = (u: UnitId) => set({ selected: u });
export const setApplyBoth = (v: boolean) => set({ applyBoth: v });

// target: "A", "B" or "both". Left out, the backend uses its shown unit.
export const sendCommand = (c: DeviceCommand, target?: CommandTarget) =>
  socket.emit("device:command", c, target);













// ---------- voice (laptop mic -> backend -> unit) ----------
// Audio is 16-bit mono PCM at 8 kHz, sent as 20 ms packets (160 samples).
export const voiceStart = (unit: UnitId, sampleRate: number) =>
  socket.emit("voice:start", { unit, sampleRate, codec: "pcm16" });
export const voiceChunk = (unit: UnitId, pcm: ArrayBuffer) =>
  socket.emit("voice:chunk", { unit, pcm });
export const voiceEnd = (unit: UnitId) => socket.emit("voice:end", { unit });

// Voice coming back from the hardware: { from, sampleRate, pcm, end }
export type VoiceRx = { from: string; sampleRate?: number; pcm?: ArrayBuffer; end?: boolean };
export const onVoiceRx = (cb: (m: VoiceRx) => void) => {
  socket.on("voice:rx", cb);
  return () => {
    socket.off("voice:rx", cb);
  };
};