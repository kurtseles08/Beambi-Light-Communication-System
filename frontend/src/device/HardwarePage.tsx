import { useState } from "react";
import {
  selectUnit,
  sendCommand,
  setApplyBoth,
  useDevice,
} from "./deviceStore";
import Panel from "../components/Panel";
import { Bar, Pill, Row, Sub, type Tone } from "../components/ui";
import type {
  DeviceCommand,
  DeviceStatus,
  PongRecord,
  UnitId,
} from "../types";

import VoicePanel from "./VoicePanel";

type SetKey = Extract<DeviceCommand, { cmd: "set" }>["k"];
const btn =
  "rounded-lg border border-forest-900/15 bg-mint-50 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-mint-200 disabled:opacity-40";
const btnOn =
  "rounded-lg border border-forest-800 bg-forest-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";

function Segmented({
  options,
  value,
  onPick,
  disabled,
}: {
  options: [number, string][];
  value: number;
  onPick: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          disabled={disabled}
          onClick={() => onPick(v)}
          className={v === value ? btnOn : btn}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  k,
  min,
  max,
  step,
  value,
  disabled,
  send,
}: {
  label: string;
  k: SetKey;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
  send: (c: DeviceCommand) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const commit = () => {
    if (local !== null) {
      send({ cmd: "set", k, v: local });
      setLocal(null);
    }
  };
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-sm text-moss-600">
        <span>{label}</span>
        <span className="font-mono text-forest-900">
          {(local ?? value).toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local ?? value}
        disabled={disabled}
        className="mt-1 w-full accent-leaf-600 disabled:opacity-40"
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
      />
    </label>
  );
}

function Message({
  title,
  tone,
  children,
}: {
  title: string;
  tone: Tone;
  children: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Hardware</h1>
      <Panel title={title} tone={tone} index={1}>
        <p className="text-[15px]">{children}</p>
      </Panel>
    </div>
  );
}

function UnitTabs({
  selected,
  online,
  onPick,
}: {
  selected: UnitId;
  online: Record<UnitId, boolean>;
  onPick: (u: UnitId) => void;
}) {
  return (
    <div role="tablist" aria-label="Unit" className="flex flex-wrap gap-2">
      {(["A", "B"] as UnitId[]).map((u) => (
        <button
          key={u}
          role="tab"
          aria-selected={selected === u}
          onClick={() => onPick(u)}
          className={selected === u ? btnOn : btn}
        >
          <span
            className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${online[u] ? "bg-leaf-500" : "bg-crit"}`}
          />
          Unit {u}
          <span className="ml-2 text-xs opacity-70">
            {online[u] ? "online" : "offline"}
          </span>
        </button>
      ))}
    </div>
  );
}

function UnitView({
  d,
  selected,
  online,
  applyBoth,
  dis,
  pongs,
}: {
  d: DeviceStatus;
  selected: UnitId;
  online: Record<UnitId, boolean>;
  applyBoth: boolean;
  dis: boolean;
  pongs: PongRecord[];
}) {
  const other: UnitId = selected === "A" ? "B" : "A";

  // Shared settings go to both units when the switch is on. Calibrate, ping and
  // message always go to the unit being viewed.
  const sendShared = (c: DeviceCommand) =>
    sendCommand(c, applyBoth ? "both" : selected);
  const sendUnit = (c: DeviceCommand) => sendCommand(c, selected);

  const copyToOther = () => {
    const cmds: DeviceCommand[] = [
      { cmd: "set", k: "txSrc", v: d.tx },
      { cmd: "set", k: "rxSink", v: d.rx },
      { cmd: "set", k: "vol", v: d.vol },
      { cmd: "set", k: "rxGain", v: d.rxGain },
      { cmd: "set", k: "micGain", v: d.micGain },
      { cmd: "set", k: "duck", v: d.duck },
      { cmd: "set", k: "gate", v: d.gate },
      { cmd: "mode", v: d.mode as 0 | 1 | 2 },
    ];
    cmds.forEach((c) => sendCommand(c, other));
  };

  const locked = d.laser === 1 && d.failover === 0;
  const stateText = d.failover
    ? d.laser
      ? "LoRa forced (laser is up)"
      : "Failover: LoRa active"
    : d.laser
      ? "Locked on laser (FSO)"
      : "Searching";
  const stateTone: Tone = locked ? "ok" : d.failover ? "warn" : "default";
  const scale = Math.max(0.3, d.thr * 3, d.env * 1.2);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const adcBad = (p2p: number) => p2p < 5 || p2p > 4000;
  const heard = d.lora.peer !== "-" && d.lora.ageS >= 0;
  const stale = !heard || d.lora.ageS > 10;
  const last = pongs.at(-1);
  const haveBat = d.batV !== undefined && d.batV > 0;
  const haveBatPct = d.batPct !== undefined && d.batPct >= 0;

  return (
    <>
      <p className="text-[15px] text-moss-600">
        Unit {d.unit} · firmware up {d.up}s · live from the ESP32
      </p>

      <div className="grid gap-5 lg:grid-cols-12">
        <Panel
          title="Link"
          tone={stateTone}
          index={1}
          className="lg:col-span-6"
          right={
            <Pill tone={stateTone}>
              {["Auto", "Force laser", "Force LoRa"][d.mode]}
            </Pill>
          }
        >
          <div
            className={`font-display text-3xl font-bold ${locked ? "text-ok-ink" : d.failover ? "text-warn-ink" : ""}`}
          >
            {stateText}
          </div>
          <Sub>
            Receiver envelope {d.env.toFixed(3)} against the link threshold{" "}
            {d.thr.toFixed(3)}
          </Sub>
          <div className="relative mt-4 h-4 rounded-full bg-forest-900/10">
            <div
              className="h-4 rounded-full bg-leaf-500 transition-[width] duration-300"
              style={{ width: pct(d.env) }}
            />
            <div
              className="absolute -top-1 h-6 w-0.5 bg-crit-ink"
              style={{ left: pct(d.thr) }}
              title="Threshold"
            />
          </div>
          <div className="mt-4">
            <Row
              label="Laser link"
              value={d.laser ? "Up" : "Down"}
              tone={d.laser ? "ok" : "warn"}
            />
            <Row label="Active path" value={d.failover ? "LoRa" : "Laser"} />
          </div>
        </Panel>

        <Panel title="Controls" index={2} className="lg:col-span-6">
          <div className="space-y-4">
            <div className="rounded-xl border border-forest-900/15 bg-mint-50 p-3 text-[13px] leading-snug text-moss-600">
              {applyBoth
                ? `Gain, volume, TX source and path mode go to both units. Calibrate, ping and message go to Unit ${selected} only.`
                : `Changes go to Unit ${selected} only.`}
              <button
                disabled={dis || !online[other]}
                className={`${btn} mt-2 block`}
                onClick={copyToOther}
              >
                Copy these settings to Unit {other}
              </button>
            </div>
            <div>
              <div className="mb-1.5 text-sm text-moss-600">TX source</div>
              <Segmented
                disabled={dis}
                value={d.tx}
                onPick={(v) => sendShared({ cmd: "set", k: "txSrc", v })}
                options={[
                  [4, "Mic"],
                  [3, "Tone"],
                  [2, "Blink"],
                  [1, "Steady"],
                  [0, "Off"],
                ]}
              />
            </div>
            <div>
              <div className="mb-1.5 text-sm text-moss-600">RX sink</div>
              <Segmented
                disabled={dis}
                value={d.rx}
                onPick={(v) => sendShared({ cmd: "set", k: "rxSink", v })}
                options={[
                  [0, "Panel"],
                  [1, "Tone"],
                  [2, "Mute"],
                ]}
              />
            </div>
            <Slider
              label="Volume"
              k="vol"
              min={0.05}
              max={1}
              step={0.05}
              value={d.vol}
              disabled={dis}
              send={sendShared}
            />
            <Slider
              label="RX gain"
              k="rxGain"
              min={1}
              max={60}
              step={1}
              value={d.rxGain}
              disabled={dis}
              send={sendShared}
            />
            <Slider
              label="Mic gain"
              k="micGain"
              min={0.5}
              max={30}
              step={0.5}
              value={d.micGain}
              disabled={dis}
              send={sendShared}
            />
            <div className="flex gap-2">
              <button
                disabled={dis}
                className={d.duck ? btnOn : btn}
                onClick={() =>
                  sendShared({ cmd: "set", k: "duck", v: d.duck ? 0 : 1 })
                }
              >
                Duck
              </button>
              <button
                disabled={dis}
                className={d.gate ? btnOn : btn}
                onClick={() =>
                  sendShared({ cmd: "set", k: "gate", v: d.gate ? 0 : 1 })
                }
              >
                Gate
              </button>
            </div>
            <div>
              <div className="mb-1.5 text-sm text-moss-600">Path mode</div>
              <Segmented
                disabled={dis}
                value={d.mode}
                onPick={(v) => sendShared({ cmd: "mode", v: v as 0 | 1 | 2 })}
                options={[
                  [0, "Auto"],
                  [1, "Laser"],
                  [2, "LoRa"],
                ]}
              />
            </div>
            <button
              disabled={dis || d.cal === 1}
              className={btn}
              onClick={() => sendUnit({ cmd: "cal" })}
            >
              {d.cal
                ? "Calibrating (3 s)..."
                : `Calibrate link threshold (Unit ${selected})`}
            </button>
            {d.cal === 1 && (
              <p className="text-xs text-warn-ink">
                Cover the panel and switch the far laser off.
              </p>
            )}
          </div>
        </Panel>

        <Panel
          title={`LoRa (Unit ${selected})`}
          tone={!d.lora.ok ? "crit" : stale ? "warn" : "ok"}
          index={3}
          className="lg:col-span-6"
        >
          {!d.lora.ok && (
            <p className="mb-2 text-sm text-crit-ink">
              LoRa module failed to start. Check wiring, 3.3 V and the band.
            </p>
          )}
          <Row
            label="Peer"
            value={heard ? `Unit ${d.lora.peer}` : "Not heard yet"}
          />
          <Row
            label="Peer laser"
            value={heard ? (d.lora.peerLaser ? "Up" : "Down") : "Unknown"}
          />
          <Row
            label="Last heard"
            value={d.lora.ageS < 0 ? "Never" : `${d.lora.ageS}s ago`}
            tone={stale ? "warn" : "default"}
          />
          <Row
            label="RSSI / SNR"
            value={heard ? `${d.lora.rssi} dBm / ${d.lora.snr} dB` : "Unknown"}
          />
          <Row label="Packets TX / RX" value={`${d.lora.tx} / ${d.lora.rx}`} />
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={dis}
              className={btn}
              onClick={() => sendUnit({ cmd: "ping" })}
            >
              Ping peer
            </button>
            <span className="text-sm text-moss-600">
              {last
                ? `Pong from ${last.from}: ${last.rssi} dBm, ${last.snr} dB`
                : "No pong yet"}
            </span>
          </div>
        </Panel>
        
        <VoicePanel unit={selected} disabled={dis} index={4} className="lg:col-span-6" />

        <Panel
          title={`Device health (Unit ${selected})`}
          index={5}
          className="lg:col-span-12"
        >
          {haveBat && (
            <Row
              label="Battery"
              value={`${d.batV!.toFixed(2)} V${haveBatPct ? ` · ${d.batPct}%` : ""}`}
              tone={
                haveBatPct && d.batPct! <= 10
                  ? "crit"
                  : haveBatPct && d.batPct! <= 20
                    ? "warn"
                    : "default"
              }
            />
          )}
          <Row
            label="Mic peak-to-peak"
            value={d.micP2P}
            tone={adcBad(d.micP2P) ? "warn" : "default"}
          />
          <Row
            label="Panel peak-to-peak"
            value={d.panP2P}
            tone={adcBad(d.panP2P) ? "warn" : "default"}
          />
          <Row
            label="Work avg / max"
            value={`${d.workAvg} / ${d.workMax} µs`}
            tone={d.workMax > 125 ? "warn" : "default"}
          />
          <Row
            label="Overruns"
            value={d.over}
            tone={d.over > 0 ? "crit" : "default"}
          />
          <div className="mt-3">
            <Bar
              pct={Math.min(100, (d.workAvg / 125) * 100)}
              tone={d.workAvg > 100 ? "warn" : "ok"}
            />
          </div>
          <Sub>
            The saPanelbudget is 125 µs at 8 kHz. A peak-to-peak near 0 or 4095
            means a stuck or saturated ADC input.
          </Sub>
        </Panel>
      </div>
    </>
  );
}

export default function HardwarePage() {
  const {
    backendUp,
    devices,
    unitsOnline,
    selected,
    applyBoth,
    canCommand,
    pongs,
    lastError,
  } = useDevice();

  if (!backendUp)
    return (
      <Message title="Backend offline" tone="crit">
        Cannot reach the backend. Is it running on port 4000?
      </Message>
    );
  if (!unitsOnline.A && !unitsOnline.B)
    return (
      <Message title="No unit connected" tone="crit">
        No reports from Unit A or Unit B. Wi-Fi: check that each unit has power,
        joined the Wi-Fi, and that DEVICE_KEY matches. USB: check the cable and
        SERIAL_PATH, and that no other program (Serial Monitor, Arduino IDE) is
        using the port.
      </Message>
    );

  const d = devices[selected];

  return (
    <div className="space-y-6">
      <div className="rise space-y-3">
        <h1 className="text-3xl font-bold">Hardware</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <UnitTabs
            selected={selected}
            online={unitsOnline}
            onPick={selectUnit}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyBoth}
              onChange={(e) => setApplyBoth(e.target.checked)}
              className="h-4 w-4 accent-leaf-600"
            />
            Apply to both units
          </label>
        </div>
      </div>
      {!canCommand && (
        <div className="rounded-xl border border-warn bg-warn/15 p-3 text-sm text-warn-ink">
          Read-only: the frontend token does not match COMMAND_TOKEN.
        </div>
      )}
      {lastError && (
        <div className="rounded-xl border border-crit bg-crit/15 p-3 text-sm text-crit-ink">
          Last command failed: {lastError}
        </div>
      )}

      {!d ? (
        <Panel title={`Unit ${selected} is offline`} tone="crit" index={1}>
          <p className="text-[15px]">
            No report from Unit {selected} for 5 seconds. Check its power and
            Wi-Fi (or the USB cable). The other unit is still available on its
            tab.
          </p>
        </Panel>
      ) : (
        <UnitView
          key={selected}
          d={d}
          selected={selected}
          online={unitsOnline}
          applyBoth={applyBoth}
          dis={!canCommand}
          pongs={pongs}
        />
      )}
    </div>
  );
}