# BeamBi

ESP32 laser audio link with a local hardware dashboard.

## Current architecture

```text
Audio:      microphone -> laser -> remote solar panel -> speaker
Monitoring: Unit B -> LoRa -> Unit A -> Bluetooth LE -> laptop backend -> dashboard
Fallback:   either unit -> USB serial -> laptop backend
```

The core system runs without internet or Wi-Fi once dependencies are installed.
LoRa and Bluetooth carry telemetry and commands, not voice. The path-mode setting
reports optical/fallback state; it does not switch off the continuous laser/DAC
audio processing or provide a LoRa voice path. Laser indication is based on the
receiver envelope and does not prove alignment or intelligible speech.

The dashboard shows Home, Alignment, Link Details, Hardware, Logs, and Display
Settings. Values are hardware reports or clearly labelled calculations. There
are no weather feeds, simulated sensors, dashboard audio streaming, optical
packet statistics, battery sensing, encryption, or tamper detection.

## Install once

Install Node.js, Python, and PlatformIO. From the repository root:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
py -3 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-ble.txt
```

Create `backend/.env` with local values:

```dotenv
BLE_ENABLED=true
SERIAL_PATHS=
SERIAL_PATH=
PORT=4000
DEVICE_KEY=choose-a-local-ingestion-key
COMMAND_TOKEN=choose-a-dashboard-control-token
PERSIST_HISTORY=false
```

Create `frontend/.env.local`:

```dotenv
VITE_BACKEND_URL=http://localhost:4000
VITE_COMMAND_TOKEN=the-same-value-as-backend-COMMAND_TOKEN
```

Keep both environment files private. `DEVICE_KEY` authenticates local reports
from the Python Bluetooth bridge. It is still required; no firmware `secrets.h`
or Wi-Fi credentials are used. The dashboard token is embedded in the browser
bundle. A missing/mismatched token gives read-only access when the backend has
`COMMAND_TOKEN` configured. Restart the relevant server after changing its env.

## Run offline

Enable laptop Bluetooth, power both units, and run `npm run dev` from the root.
Open `http://localhost:5173`. The backend scans for `BeamBi-A`, reconnects after
disconnections, and forwards fresh status. Keep A within laptop Bluetooth range
and B within A's LoRa range. A reports about once a second and B every two seconds.
Units expire after five seconds without a fresh report. No USB cable is needed
for data when Bluetooth is enabled. Full battery-only operation still needs a
physical bench check; builds and telemetry tests do not establish battery power
or audio quality.

For USB fallback, set `BLE_ENABLED=false` and `SERIAL_PATHS=COM9,COM11` using the
actual ports, then restart the backend. Close serial monitors before the backend
opens these ports. One USB gateway can also forward its LoRa peer's reports.

Commands are acknowledged when queued, not when executed. Confirm changes in
the following reports. Display Settings affect only the current browser and
are stored locally; Hardware controls change the selected unit or both units.

## Firmware

Build with `platformio run -d beambi-firmware -e unit_a -e unit_b`.
For uploading, run `platformio run -d beambi-firmware -e unit_a -t upload
--upload-port COM11` (one line), replacing target and port as appropriate.
Verify unit identity first: A MAC `28:05:a5:e2:84:64`, B `68:09:47:9d:8c:38`.
Ports change. No cleanup command automatically uploads to a board.

Both targets use microphone GPIO13, panel GPIO35, laser GPIO27, DAC GPIO25,
5 kHz sampling, and 80 kHz laser PWM. Wi-Fi stays off. Radios must match the
LoRa frequency (currently 433 MHz), SF, bandwidth, coding rate, sync word, and
CRC settings. Fit antennas before transmitting.

Microphone gain loads from NVS. Serial `G/g` adjusts it and uppercase `S` saves
it explicitly; lowercase `s` prints status. Other audio controls reset at reboot.
`q` toggles periodic serial reports and `z` toggles LoRa. Read
`beambi-firmware/TROUBLESHOOTING.md` before calibrating or diagnosing audio.
The v2 telemetry layout is retained so already-flashed units remain compatible.

## History and test runs

History is sampled every five seconds and retained in memory for up to 24 hours;
events and runs are bounded. Memory history is lost on backend restart. Export
CSV from Logs before closing if you need a permanent local record. Test distance
and notes are entered by the operator, not measured by hardware. Recorded run
duration counts received one-second dashboard samples, excluding offline gaps.

Optional Supabase history uses `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and
`PERSIST_HISTORY=true` in the backend only. The frontend has no database client.
Tables are `link_readings`, `events`, and `test_runs`. Only measured fields are
written; a legacy database must allow omitted unsupported metric columns to be
null/defaulted. Cloud persistence needs internet and is not part of offline
operation. On startup failure, the backend retains bounded memory history.

## Validation

```powershell
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
node --test backend/test_hardware.mjs backend/test_store.mjs backend/test_api.mjs
backend/node_modules/.bin/tsx.cmd --test frontend/test_telemetry.ts
py -3 -B -m unittest discover -s backend -p test_ble_bridge.py
platformio run -d beambi-firmware -e unit_a -e unit_b
```

`test_api.mjs` runs an isolated backend with Bluetooth, USB, and cloud writes
disabled. It checks telemetry, authentication, unit targeting, and expiry.
Native C++ tests in `beambi-firmware/test/` cover audio dynamics and the LoRa
telemetry codec. `verify_bluetooth.py` is a separate physical bench diagnostic
that compares USB status to Bluetooth-delivered reports without using USB as
the dashboard transport.

## Code map and recovery

- `beambi-firmware/src/main.cpp`: sampling, hardware controls, and radio loop.
- `beambi-firmware/include/`: audio dynamics, BLE gateway, v2 telemetry codec.
- `backend/src/index.ts`: local API, transport routing, device expiry.
- `backend/src/hardware.ts`: aggregate link indication and state-change events.
- `backend/src/store.ts`: bounded history, runs, optional cloud persistence.
- `backend/src/types.ts`: canonical API types; frontend re-exports them.
- `frontend/src/lib/socket.ts`: the single authenticated dashboard connection.
- `frontend/src/hooks/useTelemetry.ts`: shared fresh-data rules.

The original codebase is preserved on GitHub at
`backup/pre-cleanup-20261021-093225`, commit `b678e80`. Ignored credentials and
a source ZIP are backed up locally in `.env.backups/pre-cleanup-20261021-093225/`.
That private folder is not pushed to GitHub. Historical GPIO32 firmware under
`beambi-firmware/backups/` is reference material, not an active build target.
