# BeamBi Wi-Fi setup

**Historical instructions: superseded by the user's GPIO13 rollback.** Current
`src/main.cpp` uses GPIO13/ADC2 and has no Wi-Fi/HTTP code. All build targets use
GPIO13, including `_audio` aliases. See README.md for current upload and USB
dashboard setup. The replaced GPIO32 code is in `backups/gpio32-before-rollback/`.
Do not use the pin, sampling, or wireless instructions below for current firmware.

## Fixed wiring and audio isolation

The team reported local microphone leakage after moving to GPIO32, and pulsing
persisted with serial logs off. Shared-ADC coupling and radio/power interference
remain hypotheses, not confirmed causes. Every target now keeps GPIO32/GPIO35:

| Target | Unit | Microphone OUT | Wi-Fi | LoRa at boot |
|---|---|---|---|---|
| `unit_a_audio` | A | GPIO32 / ADC1 | Off | Asleep |
| `unit_b_audio` | B | GPIO32 / ADC1 | Off | Asleep |
| `unit_a` (default) | A | GPIO32 / ADC1 | Enabled if configured | Enabled |
| `unit_b` | B | GPIO32 / ADC1 | Enabled if configured | Enabled |

Do not move microphone OUT back to GPIO13. Upload a radio-disabled baseline
with `run -e unit_a_audio -t upload --upload-port COM7`
or `run -e unit_b_audio -t upload --upload-port COM8` (use the full executable
path shown below and actual ports). Startup confirms the expected pin and mode.
These builds intentionally do not provide Wi-Fi dashboard telemetry. Credentials
are retained but not used; there are no Wi-Fi retries. Periodic USB output is off.
LoRa can be enabled with `z` after testing audio, to check whether it adds pulses.

Test both lasers off (`0`), panel mode (`p`) and panels fully covered while
speaking into the local mic. Local speech should not be reproduced by the
intended signal path. If it remains, inspect analog/power/ground coupling and
microphone voltage/clipping; recovery firmware alone cannot correct those.
Then test the remote laser tone and microphone in one direction at a time.
Reintroduce Wi-Fi only after establishing that baseline; GPIO32 uses the same
ADC1 converter as the panel and needs hardware validation for channel leakage.

## Wiring before upload

Keep the soldered MAX4466 OUT on GPIO32 on both units. GPIO32 is ADC1 channel 4;
GPIO35 remains ADC1 channel 7 for the panel. Sampling now reads panel twice then
mic twice, discarding the first conversion on each channel to reduce possible
sample/hold carryover. Sampling is 4 kHz (250 us budget), with 250 Hz high-pass
and 1.6 kHz low-pass voice filters. This narrows the audio band compared with
the earlier 8 kHz version. DC/envelope time constants were adjusted to match.
Other connections remain unchanged, including microphone VCC
on VIN (5 V). Check microphone output voltage and peaks: a 5 V-powered module
can exceed the ESP32 ADC input limits. Moving pins does not fix clipping.

## Configuration

The existing ignored `include/secrets.h` is reused. If absent, copy
`include/secrets.example.h` to `include/secrets.h` and fill:

- `WIFI_SSID` and `WIFI_PASS`: a 2.4 GHz network reachable by both units.
- `SERVER_HOST`: laptop's LAN IPv4 address, without scheme, port or path.
  Use `ipconfig` to check it; never use localhost or 127.0.0.1.
- `SERVER_PORT`: backend port (normally 4000), not the frontend port.
- `DEVICE_KEY`: exactly the same value as `DEVICE_KEY` in `backend/.env`.

Keep the laptop on the same reachable network and the backend running. Allow
the backend through the firewall on the trusted local network if necessary.
An isolated guest network can prevent devices from reaching the laptop.
Restart the backend after changing its environment. Each board has its own IP;
both post to the same laptop address. No backend code change is needed.

## Upload

From this firmware directory in PowerShell, replace COM7/COM8 with actual ports:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_a -t upload --upload-port COM7
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_b -t upload --upload-port COM8
```

No manual UNIT_ID edit is needed. The compatibility `esp32dev` target identifies
as A with Wi-Fi/GPIO32. The default is `unit_a`; select the explicit target in
the table above for the board and radio mode being tested. All use the same pins.
Close serial monitors/backend serial connections before flashing. Disconnect
the buck output while uploading over normal USB unless power isolation is verified.
After upload, use battery power without USB to test wireless dashboard operation.

## Verify and diagnose

- Startup prints the unit ID and required GPIO32 microphone wiring.
- Send `w`: configured=1, connected=1, a LAN IP, and HTTP=200 indicate successful
  Wi-Fi/backend communication. HTTP remains 0 before the first request.
- 401: device-key mismatch; 403: backend DEVICE_KEY is not enabled.
- A negative HTTP code indicates a connection/transport failure. Check host,
  port, backend availability and firewall. connected=0 points to Wi-Fi first.
- The backend marks a unit stale after five seconds without reports.
- Queued dashboard controls arrive in HTTP replies and run in the main loop,
  where LoRa and serial controls already run. HTTP runs in its own core-1 task.
- Reports are queued once per second while Wi-Fi is connected, keeping only the
  latest pending report. When disconnected and USB logs are off, periodic JSON
  formatting is skipped too. Wi-Fi retries outside the sample task.
- Compare `workAvg`, `workMax`, and the increase in `over` with Wi-Fi connected.
  The 4 kHz period is 250 microseconds. A successful build cannot verify this
  timing or ADC channel interference on real boards.

## Pulsing controls

The sampling-overload fix, microphone gain 1, voice-band filters, `q` periodic
serial-log toggle and `z` LoRa sleep toggle are included. Periodic USB output is
**off at boot**, removing its repeating UART burst. Send `s` for one JSON status
report, or `q` to enable periodic JSON reports for diagnosis/USB dashboards.
The duplicate human-readable periodic report has been removed. Wi-Fi telemetry
continues with USB logs off. USB-only dashboards need `q` after every reboot.
Occasional event/command messages may still print. `z` disables LoRa TX/RX, not
Wi-Fi or laser audio. LoRa starts enabled after reboot. These are isolation
controls, not a guarantee that
power/ground or radio interference has been eliminated. Wi-Fi activity itself
must be checked for audible interference.

Send `v` in a configured Wi-Fi build to turn Wi-Fi fully off/on without moving
wires; dashboard telemetry pauses while off. The network task handles this
within its bounded I/O timeout. Wi-Fi modem power saving is disabled while
connected to avoid its wake/sleep cycles; this increases battery consumption.
To isolate shared-ADC leakage, keep lasers off and panel covered, then use `j`
to stop/start microphone ADC sampling. The microphone remains powered and wired,
but its conversion reads and TX audio modulation pause. If local voice disappears
only with capture off, this implicates sampling-associated coupling. If it remains,
investigate analog/power coupling. Settling reads cannot guarantee removal of
hardware leakage, optical spill, clipping, or radio interference.
