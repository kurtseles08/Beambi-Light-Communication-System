import { create } from "zustand";
import { socket } from "../lib/socket";
import type { DeviceCommand, DeviceStatus, UnitId } from "../types";


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
  lastError: string | null;
};

type InitPayload = {
  device?: DeviceStatus | null;
  deviceConnected?: boolean;
  devices?: PerUnit<DeviceStatus | null>;
  unitsOnline?: PerUnit<boolean>;
  canCommand?: boolean;
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
  lastError: null,
}));

const set = useDevice.setState;

socket.on("connect", () => set({ backendUp: true }));
socket.on("disconnect", () => set({ backendUp: false, deviceConnected: false, device: null, devices: { A: null, B: null }, unitsOnline: { A: false, B: false }, canCommand: false }));
socket.on("init", (p: InitPayload) =>
  set({
    device: p.device ?? null,
    deviceConnected: !!p.deviceConnected,
    devices: p.devices ?? { A: null, B: null },
    unitsOnline: p.unitsOnline ?? { A: false, B: false },
    canCommand: !!p.canCommand,
  }),
);
socket.on("device", (d: DeviceStatus) => set({ device: d }));
socket.on("devices", (d: PerUnit<DeviceStatus | null>) => set({ devices: d }));
socket.on("devices:online", (u: PerUnit<boolean>) => set({ unitsOnline: u }));
socket.on("device:connection", (c: boolean) =>
  set(c ? { deviceConnected: true } : { deviceConnected: false, device: null }),
);
socket.on("device:ack", (a: { ok: boolean; error?: string }) =>
  set({ lastError: a.ok ? null : (a.error ?? "failed") }),
);

export const selectUnit = (u: UnitId) => set({ selected: u });
export const setApplyBoth = (v: boolean) => set({ applyBoth: v });

// target: "A", "B" or "both". Left out, the backend uses its shown unit.
export const sendCommand = (c: DeviceCommand, target?: CommandTarget) =>
  socket.emit("device:command", c, target);
