import { create } from "zustand";
import { io } from "socket.io-client";
import type {
  DeviceCommand,
  DeviceStatus,
  LoraMessage,
  PongRecord,
  UnitId,
} from "../types";

const URL: string = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";
const TOKEN: string = import.meta.env.VITE_COMMAND_TOKEN ?? "";

type PerUnit<T> = Record<UnitId, T>;
export type CommandTarget = UnitId | "both";

type DeviceState = {
  backendUp: boolean;
  source: string;
  // The unit the backend calls SHOWN_UNIT. Home and Link details still read these two.
  device: DeviceStatus | null;
  deviceConnected: boolean;
  // Both units, for the Hardware page
  devices: PerUnit<DeviceStatus | null>;
  unitsOnline: PerUnit<boolean>;
  selected: UnitId;
  applyBoth: boolean;
  canCommand: boolean;
  loraLog: LoraMessage[];
  pongs: PongRecord[];
  lastError: string | null;
};

type InitPayload = {
  source?: string;
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
  source: "simulator",
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

const socket = io(URL, { auth: { token: TOKEN } });
const set = useDevice.setState;

socket.on("connect", () => set({ backendUp: true }));
socket.on("disconnect", () => set({ backendUp: false }));
socket.on("init", (p: InitPayload) =>
  set({
    source: p.source ?? "simulator",
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