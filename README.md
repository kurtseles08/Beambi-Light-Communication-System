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

## Current GPIO13 rollback

At the team's request, the firmware is restored to the pre-Wi-Fi audio setup:
microphone OUT GPIO13/ADC2, panel GPIO35/ADC1, 8 kHz sampling with two ADC reads,
80 kHz laser PWM, microphone gain 1, and 250 Hz/3 kHz voice filtering. Gate and
duck are off. Optimized ADC/DAC access and watchdog-overload recovery are retained.
All build targets use these pins. Wi-Fi/HTTP reporting and GPIO32 experiments
are removed from active firmware; credentials are retained but unused.

With all power disconnected, move microphone OUT back to GPIO13 before use.
VCC remains VIN (5 V); other wiring assignments are unchanged. This rollback
does not establish that microphone voltage/clipping or analog leakage is fixed.
USB status reports and LoRa start enabled. `q` pauses/resumes USB reports;
`s` prints one report; `z` pauses/resumes LoRa (useful for the observed pulsing).
Battery-only operation has no laptop dashboard connection in this version.
The backend's USB ports were cleared during Wi-Fi setup; set SERIAL_PATHS to
the actual attached COM ports and restart the backend for USB dashboard use.

The replaced GPIO32 source and build configuration are preserved locally in
`beambi-firmware/backups/gpio32-before-rollback/` and are not part of this handoff.
Previous Wi-Fi instructions are historical and do not apply to current firmware.

From `beambi-firmware`, use your board's actual COM port to upload:

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_a -t upload --upload-port COM7
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e unit_b -t upload --upload-port COM8
```

Only select the command for the board being uploaded. Close its serial monitor
first. The commands select each unit's ID automatically.
