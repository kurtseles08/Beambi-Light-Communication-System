import { useState } from "react";
import { sendCommand, useDevice } from "./deviceStore";
import Panel from "../components/Panel";
import { Bar, Pill, Row, Sub, type Tone } from "../components/ui";
import type { DeviceCommand } from "../types";

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
}: {
  label: string;
  k: SetKey;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled: boolean;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const commit = () => {
    if (local !== null) {
      sendCommand({ cmd: "set", k, v: local });
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

export default function HardwarePage() {
  const {
    backendUp,
    source,
    device: d,
    deviceConnected,
    canCommand,
    loraLog,
    pongs,
    lastError,
  } = useDevice();
  const [text, setText] = useState("");

  if (!backendUp)
    return (
      <Message title="Backend offline" tone="crit">
        Cannot reach the backend. Is it running on port 4000?
      </Message>
    );
  if (source !== "hardware")
    return (
      <Message title="Simulator mode" tone="warn">
        Set DATA_SOURCE=hardware in backend/.env and restart the backend.
      </Message>
    );
  if (!deviceConnected || !d)
    return (
      <Message title="Device disconnected" tone="crit">
        Check the USB cable, SERIAL_PATH, and that no other program (Serial
        Monitor, Arduino IDE) is using the port.
      </Message>
    );

  const dis = !canCommand;
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

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-3xl font-bold">Hardware</h1>
        <p className="mt-1 text-[15px] text-moss-600">
          Unit {d.unit} · firmware up {d.up}s · live from the ESP32
        </p>
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
            <div>
              <div className="mb-1.5 text-sm text-moss-600">TX source</div>
              <Segmented
                disabled={dis}
                value={d.tx}
                onPick={(v) => sendCommand({ cmd: "set", k: "txSrc", v })}
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
                onPick={(v) => sendCommand({ cmd: "set", k: "rxSink", v })}
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
            />
            <Slider
              label="RX gain"
              k="rxGain"
              min={1}
              max={60}
              step={1}
              value={d.rxGain}
              disabled={dis}
            />
            <Slider
              label="Mic gain"
              k="micGain"
              min={0.5}
              max={30}
              step={0.5}
              value={d.micGain}
              disabled={dis}
            />
            <div className="flex gap-2">
              <button
                disabled={dis}
                className={d.duck ? btnOn : btn}
                onClick={() =>
                  sendCommand({ cmd: "set", k: "duck", v: d.duck ? 0 : 1 })
                }
              >
                Duck
              </button>
              <button
                disabled={dis}
                className={d.gate ? btnOn : btn}
                onClick={() =>
                  sendCommand({ cmd: "set", k: "gate", v: d.gate ? 0 : 1 })
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
                onPick={(v) => sendCommand({ cmd: "mode", v: v as 0 | 1 | 2 })}
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
              onClick={() => sendCommand({ cmd: "cal" })}
            >
              {d.cal ? "Calibrating (3 s)..." : "Calibrate link threshold"}
            </button>
            {d.cal === 1 && (
              <p className="text-xs text-warn-ink">
                Cover the panel and switch the far laser off.
              </p>
            )}
          </div>
        </Panel>

        <Panel
          title="LoRa"
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
              onClick={() => sendCommand({ cmd: "ping" })}
            >
              Ping peer
            </button>
            <span className="text-sm text-moss-600">
              {last
                ? `Pong from ${last.from}: ${last.rssi} dBm, ${last.snr} dB`
                : "No pong yet"}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={text}
              maxLength={40}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message (max 40 characters)"
              className="flex-1 rounded-lg border border-forest-900/15 bg-white px-2.5 py-1.5 text-sm"
            />
            <button
              disabled={dis || !text.trim()}
              className={btn}
              onClick={() => {
                sendCommand({ cmd: "msg", text });
                setText("");
              }}
            >
              Send
            </button>
          </div>
          <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-sm">
            {loraLog.length === 0 && (
              <li className="text-moss-600">No messages received yet.</li>
            )}
            {[...loraLog].reverse().map((m) => (
              <li key={m.id}>
                <span className="font-mono text-moss-600">
                  {new Date(m.ts).toLocaleTimeString()} {m.from}:
                </span>{" "}
                {m.text}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Device health" index={4} className="lg:col-span-6">
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
            The sample budget is 125 µs at 8 kHz. A peak-to-peak near 0 or 4095
            means a stuck or saturated ADC input.
          </Sub>
        </Panel>
      </div>
    </div>
  );
}
