# BeamBi project context

Current source and README supersede historical instructions on the backup branch.

## Scope and transport

BeamBi is a two-unit laser audio prototype. The optical path is analog intensity
modulation through PWM; there is no digital optical framing, FEC, or encryption.
The receiver is a solar panel, not a photodiode/TIA. LoRa carries telemetry and
commands only. Dashboard voice streaming, unavailable sensor features, external
hazard feeds, and legacy Wi-Fi setup were removed during the codebase cleanup.

Monitoring: B -> LoRa -> A -> BLE Nordic UART -> Python Bleak -> local Node
backend -> dashboard. USB serial is optional fallback and diagnostic transport.
Both ESP32 Wi-Fi radios remain off. No firmware secrets.h is used. The backend
DEVICE_KEY is still required for local Bluetooth ingestion. Never remove the
HTTP ingestion route or command queue under the assumption it is Wi-Fi-only.

## Hardware and firmware

- A MAC 28:05:a5:e2:84:64; B MAC 68:09:47:9d:8c:38. Ports were COM11/COM9;
  verify identities before every upload because ports change.
- Active targets: unit_a and unit_b. Microphone GPIO13/ADC2 channel 4;
  panel GPIO35/ADC1 channel 7; laser GPIO27; DAC GPIO25.
- LoRa SCK18, MISO19, MOSI23, NSS5, RST14, DIO0=26, 433 MHz. Antennas required.
- Sampling 5000 Hz (200 us), laser PWM 80 kHz, voice LPF 2 kHz, HPF 250 Hz.
- MAX4466 VCC remains VIN/5 V at the user's request. Its ADC voltage/clipping
  requires physical validation. Software gain cannot repair analog clipping.
- v2 positional MessagePack telemetry is retained unchanged, including legacy
  battery=-1 and wifi=0 compatibility fields. New dashboard works with existing
  flashed firmware. Do not shrink or reorder codec fields without versioning.
- Only microphone gain persists: serial uppercase S saves to Preferences/NVS;
  G/g adjusts; lowercase s reports. Other controls reset at reboot.
- Receiver gate: noiseFloor=.008 default, opens at 3x and closes at 1.5x floor;
  closed gain .1. Suppresses pauses, not in-band buzz mixed with speech.
- Link indication uses envelope, default threshold .05; acquisition 100 ms,
  release below 70% for 3 s. It is not proof of alignment or intelligible speech.
- Calibration: remote laser OFF, panel UNCOVERED in normal operating light,
  quiet for 3 s, then restore remote laser. Recalibrate after RX gain changes.

## Physical validation status

Before cleanup, both units' raw reports matched backend values over Bluetooth
and LoRa/Bluetooth. A combined 90-second run had both units online, no uptime
resets, and zero ADC errors. USB diagnostics were connected; battery-only
integration remains pending. Do not claim battery-only or speech quality verified.
A microphone reached ADC rails 0/4095; B was roughly 2890..3010. High software
gain (30) produced clipping and is not a validated default. User heard buzz
louder than speech; covering the panel increased buzz and RX Mute removed it.
No buzz frequency or physical cause has been confirmed.

The watchdog remains enabled. Sample task yields two scheduler ticks every
100 ms; missed sample ticks are counted honestly. Do not remove this recovery
as an optimization. BLE requests MTU185, uses up to180-byte chunks when
negotiated, and safely falls back to20. Keep freshness, framing, queues, and
reconnection behavior. Cleanup removes only unused counters in the sample loop.

## Software contracts

Canonical dashboard types are backend/src/types.ts, re-exported by the frontend.
Reading/history now contain actual reported or derived signal/state values;
unsupported optical packet, battery, environment, and security metrics are absent.
Settings are local browser display zones, default42/50; they never change the
firmware threshold/hold times. Hardware controls are authoritative only after a
subsequent device report confirms them. Backend ack means queued, not delivered.

Offline history/events/runs remain bounded. Supabase is optional backend-only
storage; legacy tables must permit unsupported metric columns to be omitted.
No remote database changes are performed by cleanup. See README for commands.

## Recovery

Original GitHub backup branch: backup/pre-cleanup-20261021-093225 at b678e80.
Private local source/config backup: .env.backups/pre-cleanup-20261021-093225/.
Active working branch for cleanup: dashboardConnect. Never push private backups.
Historical GPIO32 source is under beambi-firmware/backups/ and is not compiled.
