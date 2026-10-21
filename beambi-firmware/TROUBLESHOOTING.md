# Voice link diagnosis

The audio path is local: analog microphone GPIO13 -> laser PWM GPIO27 ->
remote solar receiver GPIO35 -> DAC GPIO25 -> speaker amplifier.
The backend exchanges telemetry and controls, not audio. LoRa currently carries
status telemetry, commands, heartbeats, text and ping replies. Force LoRa does not provide voice backup;
path mode does not switch or mute the laser/DAC audio processing.

## Test in this order

1. Upload the firmware using PlatformIO `unit_a` for A and `unit_b` for B.
   IDs are selected by the build target. Keep wiring consistent with the pins above.
2. On the receiving unit, choose RX sink **Tone**, volume 0.3. A 1 kHz tone
   should sound without a laser, microphone or backend audio stream. If silent,
   check GPIO25, amplifier input/power/enable, common ground and speaker wiring.
   GPIO25 is a DAC signal output; the speaker needs an amplifier.
3. Set receiver RX sink **Panel**. On the sending unit select TX **Tone**.
   Aim the laser at the receiving panel. Check for a tone and a change in
   receiver `panP2P` when covering/uncovering the beam. No change suggests
   laser modulation, alignment, receiver wiring or signal conditioning trouble.
   A constant illuminated spot alone does not establish audio modulation.
4. Select TX **Mic**, RX **Panel**, gate off and duck off. Start with mic gain 1,
   RX gain 8 and volume 0.3. `micP2P` should respond to speech. If optical tone
   works but speech does not, inspect the analog microphone output and bias.
   The firmware expects analog audio, not an I2S microphone or digital sound
   detector output. Test one direction at a time before enabling both speakers.
5. Compare `over` before and after 10 seconds. Wi-Fi is absent in the rollback. It is a
   cumulative missed-sample counter; the increase matters. `workAvg` should
   stay below the 200 microsecond sample period, with margin. A low average
   alone does not exclude scheduling jitter or occasional long ADC reads.
6. Repeat with the backend/dashboard connected. Confirm reported TX is 4 and
   RX is 0 after commands. For Bluetooth use BLE_ENABLED=true with SERIAL_PATHS and SERIAL_PATH empty.
   For USB fallback configure SERIAL_PATHS with actual COM ports and leave
   periodic USB reports enabled (q toggles them). Restart after env changes.

If using the serial monitor, close it before the backend opens the same USB
port. Equivalent serial keys: `k` speaker tone, `p` panel audio, `3` laser tone,
`4` microphone. Dashboard controls use the same firmware settings.

## Receiver and link indication

Check the receiver's DC level and AC speech/tone signal with a meter/scope.
`panP2P` alone cannot distinguish a clipped constant input from a quiet input;
ambient light and noise can also create a large peak-to-peak reading. ADC
inputs need suitable voltage limiting, bias and amplification for the circuit.
The laser needs a driver that accepts the firmware's 80 kHz PWM modulation.

The current link indicator detects received amplitude, not a dedicated pilot;
it does not verify intelligible voice. A TX tone is available with key `3`.
Calibrate with the receiving panel UNCOVERED in normal operating light and the remote laser OFF. Keep quiet for the three-second measurement, then restore the remote laser.
Calibrating with a transmitted tone present can set the threshold too high,
potentially keeping the link marked down. There is no automatic pilot in Mic mode.

Record the hardware module models, wiring diagram, and a status JSON line from
each unit during the tone and microphone tests to diagnose remaining failures.
