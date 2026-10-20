# Beambi-Light-Communication-System
Thesis, Embedded, Emtech for CPE 4th year students 

## Dashboard hardware controls

Set `VITE_COMMAND_TOKEN` in `frontend/.env.local` to the same value as
`COMMAND_TOKEN` in `backend/.env`. If these values differ or the frontend value
is missing, the hardware dashboard connects in read-only mode.

Restart the frontend development server after changing its environment file.
For a production frontend, rebuild and redeploy after changing the token.
Restart the backend after changing `COMMAND_TOKEN`. Keep environment files out
of version control; the frontend token is included in the browser bundle.

## Two units over USB

Upload firmware with PlatformIO `unit_a` for A and `unit_b` for B; IDs are automatic.
In `backend/.env`, set `SERIAL_PATHS=COM9,COM11` (replace with the boards'
actual ports) and `SERIAL_BAUD=115200`, then restart the backend. Close serial
monitors before starting the backend so it can open both ports.

`SERIAL_PATHS` takes precedence over the single-board `SERIAL_PATH` setting.
The backend discovers each board's unit ID from its status messages and routes
dashboard commands to the corresponding port. Both units must send status
within five seconds to appear online. `SHOWN_UNIT` selects the summary unit;
the Hardware page can select either unit or apply commands to both.

## Both units on battery: Bluetooth + LoRa telemetry

No USB cable or third ESP32 is required after uploading:

```text
Unit B (battery) --LoRa--> Unit A (battery) --Bluetooth LE--> laptop/backend/dashboard
```

Both microphones remain on GPIO13/ADC2 and both ESP32 Wi-Fi radios stay OFF.
Bluetooth initializes before sampling starts. The sampler retains its original core-0 placement, with higher priority and a
200 us timing budget; the main loop and sampling timer run on core 1. A one-tick
housekeeping pause each second lets the idle watchdog run; resulting missed
sample ticks remain included in telemetry rather than being hidden.
Espressif explicitly supports ADC2 together with Bluetooth:
https://github.com/espressif/esp-faq/blob/master/docs/en/software-framework/peripherals/adc.rst
The laser still carries microphone audio. LoRa and Bluetooth carry status and
control data, not voice. Losing the laser link does not provide LoRa voice backup.

1. Temporarily connect each board by USB and upload PlatformIO `unit_a` to A
   and `unit_b` to B. IDs are selected by the build target. Close serial monitors.
2. In backend, install the Bluetooth receiver once:
   `py -3 -m venv .venv`, then
   `.venv\Scripts\python.exe -m pip install -r requirements-ble.txt`.
3. Set `BLE_ENABLED=true`, `SERIAL_PATHS=` and `SERIAL_PATH=` in `backend/.env`.
   Keep a nonempty `DEVICE_KEY` for the receiver's local HTTP ingestion.
   Leave `BLE_PYTHON` unset to use the project's .venv, or set an absolute path
   to another Python that has requirements-ble.txt installed.
4. Enable laptop Bluetooth; if needed run
   `.venv\Scripts\python.exe enable_bluetooth.py` from backend.
5. Start `npm run dev:hw` in backend and `npm run dev` in frontend. The backend
   automatically scans for the BLE device named `BeamBi-A`, connects, forwards
   fresh reports to the dashboard and reconnects after a radio/power loss.
6. Remove the USB cables and power both units from their own batteries. Keep A
   within Bluetooth range of the laptop, and B within LoRa range of A. Laptop
   Wi-Fi can remain on; laptop and ESP32 Wi-Fi credentials are not involved.

A samples/status-reports every second. B sends versioned MessagePack telemetry
once per 2 seconds in one LoRa packet. A forwards each newly received B report
without replaying cached status. BLE sends bounded, newline-framed JSON in
notifications from a separate task, with a latest-report queue per unit. Unit A
requests ATT MTU 185 and uses up to 180 bytes per notification after negotiation;
connections at the default MTU retain safe 20-byte chunks.
The receiver validates/reassembles notifications, forwards only complete reports,
and bounds delays; the existing 5-second no-report timeout makes units offline.

The dashboard's Device health shows the transport (`bluetooth` or
`lora+bluetooth`), microphone ADC errors, ADC min/max, envelope and threshold.
Signal strength 0-100 is derived from envelope/threshold, not calibrated optical
power. No battery or environment sensors are installed, so battery voltage and
percentage are shown as not measured. Changing min/max confirms sampling, not
speech quality: actual microphone/laser/speaker audio still needs a bench test.

For a wired bench verification only (backend USB must remain disabled), run
`verify_bluetooth.py COM9` from beambi-firmware using the PlatformIO Python with
pyserial installed. It compares three raw board status lines to BLE-delivered
reports field for field and checks wifi=0 / adcErrors=0. Close this diagnostic
before uploading. This checks telemetry accuracy, not physical battery power.

The backend routes commands through Bluetooth. A executes A commands and relays
B commands over LoRa. Backend acknowledgement means queued, not confirmed
radio delivery; confirm settings in subsequent hardware reports. Both LoRa
modules must match frequency (currently 433 MHz), SF, bandwidth, coding rate,
sync word and CRC settings. Fit antennas before transmitting.

USB remains an optional diagnostic/fallback transport by setting SERIAL_PATHS.
The earlier allow-lan.ps1 firewall script is not required for Bluetooth mode;
Bluetooth forwards HTTP reports only to the laptop's loopback address.

## GPIO13 audio configuration

At the team's request, the firmware is restored to the pre-Wi-Fi audio setup:
microphone OUT GPIO13/ADC2, panel GPIO35/ADC1, 5 kHz sampling with two ADC reads,
80 kHz laser PWM, microphone gain 1, and 250 Hz/2 kHz voice filtering. TX gate
and duck are off; the receiver noise gate is on. Optimized ADC/DAC access and watchdog-overload recovery are retained.
All build targets use these pins and keep Wi-Fi off. The `_audio` targets
are compatibility aliases for the same Bluetooth/LoRa firmware.

With all power disconnected, move microphone OUT back to GPIO13 before use.
VCC remains VIN (5 V); other wiring assignments are unchanged. This rollback
does not establish that microphone voltage/clipping or analog leakage is fixed.
USB status reports and LoRa start enabled. `q` pauses/resumes USB reports;
`s` prints one report; `z` pauses/resumes LoRa (useful for the observed pulsing).
For USB dashboard use, set SERIAL_PATHS to the actual attached COM ports and
restart the backend. In Bluetooth mode, neither unit needs a USB connection.

The replaced GPIO32 source and build configuration are preserved locally in
`beambi-firmware/backups/gpio32-before-rollback/` and are not part of this handoff.
Use the Bluetooth/LoRa battery instructions above for current firmware.

From `beambi-firmware`, use your board's actual COM port to upload:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_a -t upload --upload-port COM7
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_b -t upload --upload-port COM8
```

Only select the command for the board being uploaded. Close its serial monitor
first. The commands select each unit's ID automatically.

## Speech lock and receiver buzz

Live DSP timing on core 1 measured about 132 us, exceeding the old 125 us
8 kHz budget. Sampling is now 5000 Hz with an exact 200 us timer period; both
voice low-pass filters are 2000 Hz, below the 2500 Hz Nyquist limit. The Hardware
page calculates its timing budget from the reported sample rate. This trades
some high-frequency bandwidth for timing margin; audible quality needs testing.

Combined reporting exposed an IDLE0 watchdog reset on Unit A with the sample
task occupying core 0. The sampler now reserves two scheduler ticks every
100 ms for Bluetooth/system work, rather than a one-tick pause that could end
at the next tick boundary. Watchdog protection remains enabled and skipped
sample ticks remain visible in `over`; this does not guarantee gap-free audio.

Bench verification on 2026-10-20: Unit A (MAC 28:05:a5:e2:84:64, COM11) and
Unit B (MAC 68:09:47:9d:8c:38, COM9) each passed three complete raw-report
comparisons against `/api/device?unit=A` or `?unit=B`. The backend had USB ingest
disabled: A arrived through Bluetooth, B through LoRa and Bluetooth. Both had
zero ADC read errors. Both then stayed online for 90 seconds of continuous
polling without uptime resets. Battery-only validation is still pending.
Port names may change when reconnecting boards.

The dashboard's 0-100 optical strength is calculated from `env / thr`; it is
not calibrated RF RSSI or a direct microphone level. A value near 40 with the
old threshold 0.10 means receiver envelope about 0.063. The new provisional
threshold 0.05 makes the same envelope about 55 on this relative scale. Changing
Settings display-zone sliders does not change actual ESP32 lock detection.

New audio firmware (`audioV=1`) provides actual per-unit threshold and receiver
noise-floor controls on Hardware. Default lock threshold is 0.05, acquisition
requires 100 ms above it, and release requires 3 s below 70% of that threshold.
This reduces flapping between words. Since detection uses audio energy rather
than a pilot tone, silence and strong interference can still fool it; a lock is
not proof of alignment, speech intelligibility, or an error-free optical link.

A soft receiver gate is ON by default with provisional noise envelope 0.008.
It opens above 3x this level, closes below 1.5x, and attenuates pauses by about
20 dB instead of hard muting. It does not boost gain or remove an in-band buzz
while speech is passing. Compare On/Off on the same unit to judge the result.
TX microphone gate and duck settings remain unchanged.

For each receiving unit, calibrate noise with the panel UNCOVERED in its normal
lighting, far laser OFF and everybody quiet for three seconds. Then restore the
laser and speak from the far unit. Calibration sets noise floor and actual lock
threshold; choose a threshold above idle noise but below normal speech if
manual tuning is needed. Do not calibrate with the panel covered in this setup:
the team reports covering it makes the buzz louder. Recalibrate after RX gain
changes. These new adjustments are RAM-only and reset at reboot.

Mute removing the buzz points to the reproduced receiver path, not a confirmed
noise source. If the buzz remains during speech, inspect panel input/bias,
grounding, power and speaker coupling. A microphone ADC maximum of 4095 is
clipping; lower the microphone module's analog gain/check input level. Software
gain and noise gating cannot reconstruct samples clipped before processing.

Upload BOTH targets after this update: compact LoRa status protocol version 2
adds the audio controls and is not compatible with version 1. Pins, Wi-Fi-off,
Bluetooth gateway and laser voice path remain as above. Native tests cover the
speech detector, hysteresis, release hold, timer rollover, soft gate and compact
packet round trips; audible improvement still requires a hardware listening test.

## Saving microphone gain for battery operation

`G`/`g` adjust microphone gain in RAM. Send uppercase `S` to save the current
gain on that ESP32; wait for `[GAIN] saved ...` before removing power. It is
loaded at boot on USB or battery power. Lowercase `s` only prints status; the
`savedMicGain` field is -1 until a valid setting has been saved. The default
remains 1 for an unconfigured board. TX/RX mode, volume, LoRa and log toggles
still reset to their normal defaults on reboot. Flash writing can briefly
interrupt audio while S is being processed; it is not done periodically.

Choose the lowest gain that gives intelligible speech. ADC rail readings and
increasing txClipSamples indicate clipping; gain 30 should not be treated as
a calibrated default. Saving gain cannot correct microphone ADC overvoltage or
a buck supply fault. Verify buck output is 5.0 V with the actual load connected.
