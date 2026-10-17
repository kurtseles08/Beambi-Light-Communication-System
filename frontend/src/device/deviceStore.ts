import { create } from "zustand";
import { io } from "socket.io-client";
import type {
  DeviceCommand,
  DeviceStatus,
  LoraMessage,
  PongRecord,
} from "../types";

const URL: string = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";
const TOKEN: string = import.meta.env.VITE_COMMAND_TOKEN ?? "";

type DeviceState = {
  backendUp: boolean;
  source: string;
  device: DeviceStatus | null;
  deviceConnected: boolean;
  canCommand: boolean;
  loraLog: LoraMessage[];
  pongs: PongRecord[];
  lastError: string | null;
};

type InitPayload = {
  source?: string;
  device?: DeviceStatus | null;
  deviceConnected?: boolean;
  canCommand?: boolean;
  loraLog?: LoraMessage[];
  pongs?: PongRecord[];
};

export const useDevice = create<DeviceState>(() => ({
  backendUp: false,
  source: "simulator",
  device: null,
  deviceConnected: false,
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
    canCommand: !!p.canCommand,
    loraLog: p.loraLog ?? [],
    pongs: p.pongs ?? [],
  }),
);
socket.on("device", (d: DeviceStatus) => set({ device: d }));
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

export const sendCommand = (c: DeviceCommand) =>
  socket.emit("device:command", c);
