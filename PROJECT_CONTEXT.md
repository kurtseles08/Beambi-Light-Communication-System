# BeamBi: project context for Codex

## Current firmware update (2026-10-20)

Battery-gain fix added after rollback: G/g gain adjustments were RAM-only and
reset to 1 after switching power. Uppercase S now explicitly saves microphone
gain to Preferences/NVS and loads it before audio sampling starts. Lowercase s
remains one-shot status. savedMicGain=-1 means no valid stored setting. Writes
only occur on S (may briefly interrupt audio), not in the sampling loop.
Only microphone gain is persisted; modes, volume, radio/log toggles still reset.
The reported gain 30 produced substantial ADC/transmit clipping and is not a
verified suitable default. Battery supply and actual audio need bench validation.

The user explicitly requested rollback to the earlier GPIO13 audio setup.
Active src/main.cpp now uses microphone GPIO13/ADC2 channel 4 and panel
GPIO35/ADC1 channel 7. Every PlatformIO target uses these pins. The team must
move microphone OUT back from GPIO32 to GPIO13 with all power disconnected.
Microphone VCC remains VIN (5 V), as requested; its ADC voltage range/clipping
still needs appropriate verification. The receiver's 1 uF capacitor is electrolytic.

Restored: 8 kHz sampling, one read per ADC per tick, 80 kHz PWM, microphone gain 1,
250 Hz high-pass and 3 kHz low-pass voice filters, gate/duck off. Optimized direct
ADC/DAC access, ADC power hold and bounded watchdog-overload recovery are retained.
Wi-Fi/HTTP, GPIO32/ADC1 microphone reads, settling dummy reads, 4 kHz sampling,
network queues and j/v/w diagnostics are removed from active firmware.

Use unit_a / unit_b for automatic IDs. USB JSON reports and LoRa start enabled;
q toggles periodic reports, s prints one status, z toggles LoRa. LoRa activity
was observed to trigger periodic pulsing; rollback is not proof that this or
analog leakage/clipping is fixed. Local speech persisted previously with mic
ADC sampling and radios off; its physical source remains unconfirmed. Photos
were inspected but no GPIO32-GPIO35 solder bridge was visually confirmed.

The GPIO32/Wi-Fi source and build configuration were saved before rollback in
beambi-firmware/backups/gpio32-before-rollback/ as text files. Wi-Fi credentials
are retained locally but unused. Backend serial port settings were cleared for
Wi-Fi earlier; actual SERIAL_PATHS must be configured for USB dashboard use.
Battery-only operation has no dashboard transport in the rollback version.
The historical sections below are subordinate to this current update.
Written 2026-10-20 from a long hardware/firmware debugging conversation with Simon Sangalang (BeamBi team member). Codex has the repo (`kurtseles08/Beambi-Light-Communication-System`). This file explains the hardware, the reasoning, the current state and the open problems, so you can work on the code and help diagnose hardware. Items marked **(verify in source)** come from conversation memory and should be checked against the repo.

---

## 1. What BeamBi is

**BeamBi: Design of a Deployable Laser-Based Free-Space Optical Communication System for Audio Data Transmission.** A Computer Engineering design project (CPE 0414.1, CPE Practice and Design 1) at Pamantasan ng Lungsod ng Maynila (PLM), Manila. Team: Bigael, Gonzales, Ricabar, Roque, Sangalang, Seles. Faculty: Engr. Evangeline P. Lubao.

**Problem.** In major disasters (the proposal cites Typhoon Odette, 2021), cellular, power and RF infrastructure fail or congest. FSOC (free-space optical communication) gives a direct point-to-point link with no towers, no backhaul and no RF spectrum license.

**Goal.** A portable, low-cost, short-range, battery-powered, **full-duplex voice** link between two identical units ("Portable Unit A and B") over a visible **650 nm laser**, as a *supplementary* option for search-and-rescue, LDRRMO and command-post use. It is manually aimed on purpose, to keep it cheap and quick to improvise.

**Evaluation criteria in the proposal:** communication capability, operating range (to be measured, not assumed; the literature shows a 650 nm link over about 300 m at 10 Mb/s), alignment tolerance, environmental sensitivity (sun, fog, haze, rain), deployment requirements, power (about 4 to 6 h on about 2000 mAh), and usability.

**Proposed architecture** (from the proposal paper): mic → signal conditioning → ADC → ESP32 (encrypt AES-256, framing, FEC, link control) → laser driver → laser, and photodiode → TIA front end → ESP32 → decode → speaker, plus a monitoring dashboard. It also lists a tamper sensor. Physical layout: **Head** (laser, driver, photodiode array, receiver front end, on a 2-axis gimbal), **Body** (ESP32, mic, battery, speaker), **Stand** (tripod), joined by an adjustable neck.

**What is actually built right now differs from the proposal, and this matters:**
- The prototype uses **analog intensity modulation (IM/DD)**. The voice samples directly set the laser's PWM duty cycle. There is **no digital framing, FEC or encryption yet.**
- **Transmitter:** KY-008 red laser module driven by a 2N2222, not a laser diode with a custom driver.
- **Receiver:** a **small solar panel** with a passive bias and RC network into the ESP32 ADC, not a PIN photodiode with a TIA. (A TIA is now the recommended fix, see section 7.)
- A **LoRa (SX127x) backup link** was added for failover. It is not in the proposal.
- A 3-cell Li-ion pack with a buck converter replaces the proposal's single cell with TP4056.

## 2. Methodology so far

Bring-up has been incremental and measurement-driven, using a single ESP32 per unit:
1. Self-test paths on one unit: speaker alone (tone), laser alone (steady and modulated, seen on a phone camera), mic alone (serial print of raw ADC), panel alone (torch), loopback (own laser into own panel).
2. Talk-through firmware: mic → conditioning → laser PWM, and panel → conditioning → DAC → PAM8403 → speaker.
3. Serial logging with counters (overruns, envelope, link state) and a multimeter at key nodes.
4. Problems are isolated by swapping one thing at a time. A purely analog laser driver (no ESP32) served as the reference to prove the receiver chain was sound.

## 3. Hardware, per unit (schematic of record)

Source of truth for wiring: the artifact **"BeamBi Single Unit"** (https://claude.ai/artifact/CJoRi3Ajs7Jgt79dQ4vxeY, version 5), which includes the LoRa module and the battery power block. It is an SVG drawing plus a wiring table. The wiring below follows it except for the microphone supply update confirmed by Simon on 2026-10-20: MAX4466 VCC now connects to VIN (5 V). Both prototype units are now **soldered**, except the power circuit. They are still powered over laptop USB for bench tests.

### 3.1 Pin map (ESP32 DevKit, 30-pin style)

| ESP32 pin | Function | Notes |
|---|---|---|
| GPIO35 | Solar panel receive (ADC1) | Input only. Through the 4.7k + 10nF filter. |
| GPIO13 | MAX4466 mic OUT (ADC2_4) | **Changed from GPIO34.** ADC2 does not work while Wi-Fi is on. |
| GPIO27 | Laser PWM (LEDC, 80 kHz, 9-bit) | Through 1k to the 2N2222 base. |
| GPIO25 | DAC1 audio out | Through 1 µF to the PAM8403 L input. |
| GPIO18 | LoRa SCK | |
| GPIO19 | LoRa MISO | |
| GPIO23 | LoRa MOSI | |
| GPIO5 | LoRa NSS | Strapping pin; works for NSS. |
| GPIO14 | LoRa RST | |
| GPIO26 | LoRa DIO0 | This is also DAC2, which is unused. |
| GPIO4 | Free. Optional battery-voltage readout (ADC2) | Divider 100k/33k, 0.1 µF at the tap. Not drawn in the artifact. |
| 3V3 | Panel bias, LoRa VCC | |
| VIN (5 V) | 5 V rail | KY-008 S, MAX4466 VCC, and PAM8403 power + hang on this rail. |
| GPIO12 | Keep free | Boot strapping pin. |

### 3.2 Receive path (solar panel)

Panel + → 1 µF → **node A**. Node A: 10k to 3V3 and 10k to GND (bias about 1.65 V). Node A → 4.7k → **node B** → GPIO35. Node B: 10 nF to GND. Panel − → GND.
- The coupling capacitor was originally polarized. If polarized, **+ goes toward node A** (the higher DC side). In bright light the open-circuit panel voltage can exceed 1.65 V and reverse the cap, so a **non-polarized (ceramic/film) 1 µF** is preferred.
- The artifact labels the filter "LPF about 3.4 kHz" (4.7k alone with 10 nF). Counting the 5k from the bias network in series, the real corner is **about 1.6 kHz.** The signal band is voice, so this is acceptable.

### 3.3 Mic path

MAX4466 module: VCC → VIN (5 V), GND → GND, OUT → GPIO13 (supply updated by Simon on 2026-10-20). With the usual half-supply output bias, OUT is expected near 2.5 V; measure the actual module. A 5 V-powered output can exceed the ESP32 ADC input range and GPIO voltage limit: verify the signal swing and add suitable attenuation or AC coupling with a 3.3 V-referenced bias before relying on this direct connection. Past problems: a stuck-at-0 reading from an unpowered or swapped module, and clipping from too much gain (lower the module's trimmer). Earlier advice added an RC filter on the mic output and a filtered supply for the mic. The artifact does not draw these.

### 3.4 Laser path

GPIO27 → 1k → 2N2222 base. Emitter → GND. Collector → KY-008 "−" pin. KY-008 **S pin → 5 V rail.** This was confirmed working. Check the transistor's pin order (E-B-C for a typical plastic PN2222A). Some brands are C-B-E. **Laser safety:** never aim at eyes or shiny surfaces, and never use a mirror for loopback.

### 3.5 Audio out

GPIO25 (DAC1) → 1 µF (+ on the GPIO25 side) → PAM8403 module **L** input. **C** (audio-input common) → GND. The R input is unused. Power + → 5 V rail, power − → GND. Speaker across **LOUT+ and LOUT−** only. ROUT is unused. **Never ground the PAM outputs** (bridged output). The module's volume pot is the loudness control. Set the DAC signal large and the pot for loudness, because the DAC is only 8 bits (about 50 dB SNR ideal).

### 3.6 LoRa backup

SX127x module (SPI): SCK 18, MISO 19, MOSI 23, NSS 5, RST 14, DIO0 26, **3.3 V only.** Attach the antenna before powering. Put 100 µF + 0.1 µF across 3V3/GND at the module. Library: Sandeep Mistry **LoRa**. `LORA_FREQ` must be set per module and local rules. SF7, BW 125 kHz, CR 4/5, sync word 0xB1.
- A standalone test node (`UNIT_ID='T'`) was verified against the unit by serial logs: heartbeats and pongs received, RSSI about −35 dBm, SNR about 9.5 to 10 dB, at close range.
- If an upload fails with "Failed to communicate with the flash chip", check wiring (GPIO12, LoRa power) and the USB cable, not the code.

### 3.7 Power (new, not yet wired and tested)

**3S Li-ion pack (3×18650, series, about 11 V nominal) → SPST switch (positive wire) → HCW-PZ15 buck, set to 5.0 V → 5 V rail** (ESP32 VIN, MAX4466 VCC, KY-008 S pin, PAM8403 power +). Buck OUT− and pack − to the common ground.
- The HCW-PZ15 has no datasheet I could find. Its input range, current rating, fixed or adjustable output and pin labels are **unconfirmed.** Measure with a multimeter before connecting.
- The pack's cell chemistry was described as "3.3 V Li-ion". Confirm on the label (Li-ion 3.7 V versus LiFePO4 3.2 V).
- **Not included right now:** BMS, fuse, reverse-polarity diode, input capacitor, charger. These were recommended but not available yet.
- **Never connect USB and the buck to VIN at the same time** unless a diode is in line. For programming, disconnect the buck output.
- 3S in parallel would need a boost converter instead, and was not chosen.
- Expected current is about 250 mA average at 5 V (rough, unmeasured).

## 4. Firmware (verify all in source)

Main file in the conversation: `beambi_unit_lora.ino` (Arduino IDE, supports ESP32 Arduino core 2.x and 3.x through `ESP_ARDUINO_VERSION_MAJOR`). Standalone `lora_test_node.ino` is the other node. The repo may contain different or newer versions of these.

- **Sampling loop:** 8 kHz hardware timer, task on core 0. Per tick: read the panel ADC (GPIO35) and the mic ADC (`PIN_MIC`), run the DSP, write the DAC (GPIO25) and set the laser PWM duty.
- **Time budget:** each `analogRead` is about 45 µs. The tick is 125 µs, so **two ADC reads per tick fit and three do not.** A third dummy read once pushed the work to about 141 µs, starved the idle task and caused a watchdog reboot loop.
- **Known bug (fixed in the chat, not confirmed in the repo):** `if (n > 1) { overruns += n - 1; vTaskDelay(1); }` made the loop run at about 1 kHz (the `over=` counter climbing about +7,000/s). It must be `if (n > 1) overruns += n - 1;`.
- **Modulation:** duty d(n) = B + D·m(n), B = 0.5, D = 0.4 (modulation index 0.8). LEDC carrier **80 kHz at 9-bit** (80,000 = 10 × 8,000, so the carrier aliases to 0 Hz in the 8 kHz sampling and the 250 Hz high-pass removes it). 78,125 Hz was tried first and aliased to a 1,875 Hz tone. The LEDC limit is carrier × 2^bits ≤ 80 MHz. Sampling jitter could turn leftover carrier into broadband noise (an untested hypothesis).
- **Receive DSP:** DC blocker (corner about 6.4 Hz), RBJ biquad **high-pass at 250 Hz** (only about −13 dB at 120 Hz light flicker), DC tracker α = 0.001 (about 125 ms), optional **gate** and **duck**. Both gate and duck were cutting quiet voice and music. Defaults are now `duckOn = false` and `gateOn = false`, which clearly improved sound.
- **ADC notes:** ADC1 channels share one converter and the sample-and-hold can leave charge on the next channel (suspected crosstalk from GPIO34 into GPIO35). The mic was moved to **ADC2 (GPIO13)** to avoid that. ADC2 conflicts with Wi-Fi.
- **LoRa protocol:** messages are `BB:<id>:<type>:<payload>`. Types: **H** heartbeat (payload `up/down/FO,<env×1000>`), **M** message, **P** ping, **R** pong. `UNIT_ID='A'` on the unit.
- **Failover state machine:** link-up detection from the received envelope against `linkThresh` (500 ms to declare up, 3,000 ms to declare down), `pathMode` AUTO / LASER / LORA.
- **Serial keys known:** `3` = 1 kHz tone (use this for failover tests), `l`, `c`, `b`, `>text` (send a LoRa message). Others are in the source.
- **Known limitation:** envelope detection cannot tell silence from link loss, so test failover with the far unit sending the tone. A **pilot tone** is the proper fix, planned and not built.
- **Not implemented:** voice over LoRa (needs a low-rate vocoder such as Codec2 at 700 to 3,200 bit/s plus push-to-talk), framing/FEC/encryption, dashboard.

## 5. Why things are the way they are (design decisions)

- **Analog PWM-carrier modulation** was chosen to get audio working fast on one ESP32, with the PWM acting as the laser's analog brightness. Digital IM would need framing and FEC, which remain future work.
- **Carrier alignment to the sample rate** (80 kHz = 10× 8 kHz) removes the carrier at the ADC without a filter.
- **Panel front end is passive** (1 µF + bias + RC) because it was the minimum to get signal into the ADC. Its weakness is the panel's own signal-dependent impedance (see section 7).
- **Gate and duck off** because voice and music were being cut. They were added to suppress mic leakage when the laser is off.

## 6. Problems found and resolved (status)

| Problem | Cause / resolution | Status |
|---|---|---|
| Laser did not change with mic input | Mic wiring/gain; diagnosed with raw-ADC print and a laser test sketch | Resolved |
| Panel reads about 0.1 V on a meter | Normal: open-circuit panel in dim light, capacitor-coupled, so DC is blocked | Explained |
| Heavy noise, weak voice | Mic clipping, gain, ADC crosstalk, and gate/duck cutting audio. Moved mic to ADC2 (GPIO13), gate/duck off | Mostly resolved |
| Voice heard with panel covered and laser off | Electrical/acoustic leak and ADC1 crosstalk between mic and panel channels | Addressed (ADC2 mic) |
| Reboot loop after upload | Extra `analogRead` exceeded the 125 µs tick → watchdog | Resolved (removed) |
| ESP32-driven laser sounded poor, analog-driven laser sounded good | Modulation chain/gate/duck; carrier and noise handling. Turning gate/duck off improved it | Improved |
| `vTaskDelay(1)` in the overrun branch | Locks the loop near 1 kHz | Fix told to user, unconfirmed in repo |
| LoRa verification | Serial logs good (RSSI about −35 dBm, SNR about 10 dB) | Working |
| Upload "flash chip" error | Hardware/cable/boot-pin wiring, not code | Resolved by user |

## 7. Open problems

**7.1 (current, main) Speaker loud with the panel facing the ground, quiet when facing ambient light.** Started after the team replaced the solid wires to the panel and speaker with soldered **stranded hanging wires** (the only change reported). Two competing explanations:
- **Ambient-light loading (physics, likely contributes).** The panel is a current source with a parallel diode. In the dark its parallel resistance is megaohms, so almost all of the laser's signal current goes into the roughly 10 kΩ input network. In ambient light the diode conducts and its resistance drops to tens or hundreds of ohms, which shunts the signal current and drops the received voltage by an order of magnitude or more.
- **Wiring (could be the trigger).** Long, unshielded stranded wire on a high-impedance panel lead picks up hum and noise and can have cold joints, stray strands, or a poor ground. These faults would typically cause crackle, hum or dropouts rather than "quiet only in light", but the timing suggests checking them first.
- **Tests:** (1) shade the panel while it faces up. If the speaker gets loud again, it is ambient loading. (2) Wiggle the wires and listen for crackle. (3) Continuity-check panel +, panel −, speaker leads and the solder joints. (4) Swap to short, rigid or twisted-pair/shielded leads. (5) Compare panel open-circuit voltage dark and in ambient light. (6) Print the received envelope and peak-to-peak on serial for facing-up/down with the laser on and off.
- **Fixes:** a hood or dark tube around the panel (also in the casing design), a red filter over the panel (passes 650 nm, cuts ambient), and, most robust, replacing the passive input with a **transimpedance amplifier** (op-amp such as MCP6002 on 3.3 V with a feedback resistor), so gain no longer depends on panel resistance or light level. This matches the proposal's own "TIA" front end.

**7.2 Power system.** Not yet built and tested (section 3.7). Items to confirm: HCW-PZ15 specs, cell chemistry, buck output set to exactly 5.0 V first, noise from the switching supply compared against USB.

**7.3 Link detection.** Add a pilot tone so failover can tell silence from a lost laser link.

**7.4 Voice over LoRa.** Needs a low-rate vocoder and push-to-talk. Not started.

**7.5 Dashboard.** The proposal lists about 14 readouts (link, signal strength, SNR, latency, loss, bitrate, laser/receiver status, alignment, ambient light, battery, interference). **If it runs over Wi-Fi, ADC2 (the mic on GPIO13) stops working.** Move the mic to an ADC1 pin first (GPIO32 or GPIO33, with the earlier GPIO35 crosstalk caveat), or use a wired OLED.

**7.6 Mechanical.** See section 8.

## 8. Mechanical design (decided, not built)

Reference artifacts: "BeamBi Casing Layout" and "BeamBi Aiming Practice". Recommendations made against the team's own Head/Body/Stand diagram:
- Keep the Head/Body/Stand split. Hold the head on a **yoke** whose tilt axis passes through the head's center of mass (not a side-mounted gimbal).
- **Fixed short neck**, not telescoping. Get height from the tripod legs.
- Put the **TX driver and receiver filter board in the head**, close to the laser and the panel (short high-impedance panel lead). Run only about 6 wires down the neck: 5 V, 3V3, GND, panel signal (twisted with a ground), laser gate, spare GND.
- Black baffle between the laser and the panel, and a short dark **tube** in front of the panel.
- Body bolts to the tripod head plate (1/4"-20). Heaviest parts low and centered. Speaker on a side wall on foam, mic on the opposite side, OLED on the operator-facing rear.
- **Aiming tolerance:** 0.1° of head movement shifts the spot about 1.7 cm at 10 m. Use fine-pitch screws and locks on both axes (an M3 screw on a 50 mm lever arm gives about 0.57° per full turn). Hobby servos are too coarse.
- Cheap parts to source quickly in the Philippines: a generic 3-way pan-tilt tripod head, or a hardware-store DIY gimbal. Makerlab Electronics sells an SG90/MG90S pan-tilt bracket for later experiments.
- Casing: 5 mm black Sintra for walls, 3 mm for partitions, about 200 × 120 × 80 mm.

## 9. Gotchas for anyone touching the hardware

- **Laser safety.** Class IIIA about 5 mW at 650 nm.
- 3.3 V only on LoRa and the ESP32 GPIOs. Never feed 5 V into a GPIO.
- Antenna before power on the LoRa module.
- 2N2222 pin order differs between makers. Verify it with a meter.
- PAM8403 outputs are bridged. Never ground LOUT.
- ADC2 pins are unusable while Wi-Fi is on.
- Never join USB and the buck at VIN.
- Pins 6 to 11 (flash) must not be used, and GPIO12 must stay free at boot.
- The KY-008 S pin goes to **5 V** in this build, with the "−" pin switched to ground by the transistor.

## 10. How to help (instructions to Codex)

1. First compare the repo's firmware to sections 3 and 4: pin map, ADC usage per tick, the `vTaskDelay(1)` line, gate/duck defaults, `PIN_MIC`.
2. For hardware questions, reason from the schematic of record (section 3) and ask for specific measurements (voltages at node A, node B and GPIO35; peak-to-peak counts; open-circuit panel voltage; the `over=` counter) rather than guessing.
3. Do not change the pin map without telling the team, because the soldered boards would no longer match.
4. Prefer small diagnostic additions (serial counters, tone test) over large rewrites. Keep the sampling tick under 125 µs.
5. Treat the open problems in section 7 as the work list. The team's priority is the panel-sensitivity problem (7.1), then the power system (7.2).
