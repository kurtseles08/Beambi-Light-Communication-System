/*
 * beambi_unit_lora.ino -- BeamBi unit: laser audio link + LoRa backup channel (ESP32 DevKit)
 * One file. Needs the "LoRa" library by Sandeep Mistry (Library Manager).
 *
 * Wiring: same as before, plus the LoRa module (SX1276/SX1278, 3.3 V ONLY):
 *   LoRa 3.3V -> ESP32 3V3   (+100uF and 0.1uF across the module's 3.3V and GND)
 *   LoRa GND  -> GND
 *   LoRa SCK  -> GPIO18      LoRa MISO -> GPIO19      LoRa MOSI -> GPIO23
 *   LoRa NSS  -> GPIO5       LoRa RST  -> GPIO14      LoRa DIO0 -> GPIO26
 *   Antenna attached BEFORE power. Never transmit without it.
 *
 * What this version adds (stage 1 of the backup channel):
 *   - Unit B LoRa status every 2 s; Unit A replies and forwards it to USB
 *   - text messages over LoRa: type a line starting with > (example  >hello)
 *   - ping with RSSI/SNR: key b
 *   - failover state machine: laser link up/down detection, AUTO / force laser / force LoRa
 *   NOT included: voice over LoRa. That needs a low-rate vocoder (for example Codec2);
 *   raw audio does not fit in a LoRa channel.
 *
 * Laser audio keys (as before): 4 mic  3 tone  2 blink  1 steady  0 off | p panel  k tone  x mute
 *   + - volume   ] [ rx gain   G g mic gain   d duck   n gate   h help
 * New keys: l cycle path mode (AUTO / LASER / LORA)   c calibrate link threshold (3 s)
 *           b LoRa ping   >text  send a LoRa message
 *
 * Restored pre-Wi-Fi audio configuration: mic GPIO13/ADC2, panel GPIO35/ADC1.
 * Select unit_a (Bluetooth gateway) or unit_b (LoRa remote). Both run on battery.
 * Wi-Fi stays OFF. Both retain the GPIO13 microphone. USB is optional after upload.
 */
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "lora_telemetry.h"
#include "ble_gateway.h"
#include "audio_dynamics.h"
#if ESP_ARDUINO_VERSION_MAJOR < 3
#include <driver/adc.h>
#include <driver/dac.h>
#endif

// ----------------------------------------------------------------- pins
constexpr int PIN_MIC = 13;
constexpr int PIN_PANEL = 35, PIN_LASER = 27, PIN_DAC = 25, PIN_LED = 2;
constexpr int LORA_SS = 5, LORA_RST = 14, LORA_DIO0 = 26;   // SCK 18, MISO 19, MOSI 23 are the default SPI pins

// ----------------------------------------------------------------- LoRa settings (must match on every node)
#ifndef BEAMBI_UNIT_NUMBER
#define BEAMBI_UNIT_NUMBER 0
#endif
static_assert(BEAMBI_UNIT_NUMBER == 0 || BEAMBI_UNIT_NUMBER == 1, "Select unit_a or unit_b");
constexpr char UNIT_ID = BEAMBI_UNIT_NUMBER == 0 ? 'A' : 'B';
constexpr long     LORA_FREQ  = 433E6;      // SET TO YOUR MODULE'S BAND (433E6, 868E6, 915E6) AND LOCAL RULES
constexpr int      LORA_SF    = 7;          // 7 = fastest, 12 = longest range
constexpr long     LORA_BW    = 125E3;
constexpr int      LORA_CR    = 5;          // 4/5
constexpr int      LORA_POWER = 14;         // dBm
constexpr int      LORA_SYNC  = 0xB1;
constexpr uint32_t HB_MS = 2000, HB_FAILOVER_MS = 1000;

// ----------------------------------------------------------------- audio tunables
constexpr int      FS_HZ          = 5000; // Exact 200 us period; leaves CPU headroom for BLE and idle housekeeping.
constexpr uint32_t LASER_PWM_HZ   = 80000;
constexpr int      LASER_PWM_BITS = 9;
constexpr float TX_BIAS  = 0.50f;
constexpr float TX_DEPTH = 0.40f;
constexpr float RX_HPF_HZ = 250.0f;
constexpr float DC_TRACK  = 0.001f;
constexpr float ENV_TRACK = 0.002f;
constexpr float MIC_TRACK = 0.01f;
constexpr float GATE_OPEN = 0.020f, GATE_CLOSE = 0.010f;
constexpr float DUCK_THRESHOLD = 0.05f, DUCK_GAIN = 0.25f;

// ----------------------------------------------------------------- runtime settings
static volatile int   txSrc = 4;
static volatile int   rxSink = 0;
static volatile float micGain = 1.0f;
static float savedMicGain = 1.0f;
static bool hasSavedMicGain = false;
static volatile float rxGain = 8.0f;
static volatile float vol = 0.60f;
static volatile bool  duckOn = false;
static volatile bool  gateOn = false;
static volatile float linkThresh = 0.05f;   // provisional; calibrate with the far laser OFF, panel uncovered
static volatile bool rxGateOn = true;
static volatile float rxNoiseFloor = 0.008f; // provisional idle envelope; calibrate per unit
static ReceiverNoiseGate receiverGate;
static SpeechLinkDetector linkDetector;

// ----------------------------------------------------------------- DSP helpers
struct DcBlocker { float x1 = 0, y1 = 0;
  float process(float x) { float y = x - x1 + 0.995f * y1; x1 = x; y1 = y; return y; } };
struct Biquad { float b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
  float process(float x) { float y=b0*x+z1; z1=b1*x-a1*y+z2; z2=b2*x-a2*y; return y; }
  void highpass(float fs, float fc, float q=0.7071f) {
    float w0=2.0f*(float)M_PI*fc/fs, cs=cosf(w0), al=sinf(w0)/(2.0f*q), a0=1.0f+al;
    b0=((1.0f+cs)*0.5f)/a0; b1=-(1.0f+cs)/a0; b2=b0; a1=(-2.0f*cs)/a0; a2=(1.0f-al)/a0; }
  void lowpass(float fs, float fc, float q=0.7071f) {
    float w0=2.0f*(float)M_PI*fc/fs, cs=cosf(w0), al=sinf(w0)/(2.0f*q), a0=1.0f+al;
    b0=((1.0f-cs)*0.5f)/a0; b1=(1.0f-cs)/a0; b2=b0; a1=(-2.0f*cs)/a0; a2=(1.0f-al)/a0; } };
static inline float clampf(float v, float lo, float hi) { return v<lo?lo:(v>hi?hi:v); }

// Load before sampling starts; write only on explicit S, never per sample or tick.
static void loadMicGain() {
  Preferences prefs;
  if (!prefs.begin("beambi-audio", false)) {
    Serial.println(F("[GAIN] storage unavailable; using microphone gain 1"));
    return;
  }
  float value = prefs.getFloat("micGain", 1.0f);
  bool stored = prefs.isKey("micGain");
  prefs.end();
  if (isfinite(value) && value >= 0.5f && value <= 30.0f) {
    micGain = savedMicGain = value;
    hasSavedMicGain = stored;
  }
  Serial.printf("[GAIN] startup micGain=%.2f (%s)\n", (float)micGain,
    hasSavedMicGain ? "saved" : "default; G/g adjust, S saves");
}

static void saveMicGain() {
  float value = micGain;
  if (!isfinite(value) || value < 0.5f || value > 30.0f) return;
  if (hasSavedMicGain && value == savedMicGain) {
    Serial.printf("[GAIN] micGain=%.2f already saved\n", value);
    return;
  }
  Preferences prefs;
  if (!prefs.begin("beambi-audio", false)) {
    Serial.println(F("[GAIN] save FAILED: storage unavailable"));
    return;
  }
  size_t written = prefs.putFloat("micGain", value);
  prefs.end();
  if (written == sizeof(float)) {
    savedMicGain = value;
    hasSavedMicGain = true;
    Serial.printf("[GAIN] saved micGain=%.2f; restored after power cycle\n", value);
  } else Serial.println(F("[GAIN] save FAILED; gain has not been confirmed stored"));
}

// ----------------------------------------------------------------- state
static TaskHandle_t sampleTask = nullptr;
static hw_timer_t  *sampleTimer = nullptr;
static DcBlocker micDc;
static Biquad    rxHpf, rxLpf, micHpf, micLpf;
static float rxDc = 1875.0f, rxEnv = 0, micEnv = 0, gateG = 1, duckG = 1;
static bool  gateOpenState = false;
static float tonePhase = 0, spkPhase = 0;
static uint32_t tick = 0;

static volatile float rxEnvOut = 0, rxPeak = 0;
static volatile int   micMin = 4095, micMax = 0, panMin = 4095, panMax = 0;
static volatile uint32_t panSum = 0, panCnt = 0;
static volatile uint32_t overruns = 0, workMax = 0, workSum = 0, workCnt = 0;
static volatile uint32_t adcErrors = 0;
static volatile uint32_t micRailSamples = 0, micSamples = 0, txClipSamples = 0;
static const uint32_t MAXD = (1u << LASER_PWM_BITS) - 1;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  static inline void laserInit() { ledcAttach(PIN_LASER, LASER_PWM_HZ, LASER_PWM_BITS); }
  static inline void laserWrite(uint32_t d) { ledcWrite(PIN_LASER, d); }
#else
  static inline void laserInit() { ledcSetup(0, LASER_PWM_HZ, LASER_PWM_BITS); ledcAttachPin(PIN_LASER, 0); }
  static inline void laserWrite(uint32_t d) { ledcWrite(0, d); }
#endif

void IRAM_ATTR onSampleTimer() {
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(sampleTask, &woken);
  if (woken) portYIELD_FROM_ISR();
}

// ----------------------------------------------------------------- 5 kHz sample task (core 0; main loop/timer run on core 1)
static void sampleLoop(void *) {
  TickType_t lastRecovery = xTaskGetTickCount();
  for (;;) {
    uint32_t n = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    if (n > 1) overruns += n - 1;
    int64_t t0 = esp_timer_get_time();

    int rawMic, rawPan;
#if ESP_ARDUINO_VERSION_MAJOR < 3
    // One read per input, using separate converters. Configure only in setup.
    if (adc2_get_raw(ADC2_CHANNEL_4, ADC_WIDTH_BIT_12, &rawMic) != ESP_OK) {
      rawMic = 2048; // Neutral input on ADC2 failure; never treat a failed read as speech.
      adcErrors++;
    }
    rawPan = adc1_get_raw(ADC1_CHANNEL_7);
#else
    rawMic = analogRead(PIN_MIC);
    rawPan = analogRead(PIN_PANEL);
#endif

    micSamples++;
    if (rawMic <= 8 || rawMic >= 4087) micRailSamples++;
    if (rawMic < micMin) micMin = rawMic;
    if (rawMic > micMax) micMax = rawMic;
    if (rawPan < panMin) panMin = rawPan;
    if (rawPan > panMax) panMax = rawPan;
    panSum += rawPan; panCnt++;

    // RX: panel -> DC track -> HPF -> gain -> speaker
    rxDc += DC_TRACK * ((float)rawPan - rxDc);
    float y = rxLpf.process(rxHpf.process(((float)rawPan - rxDc) / 2048.0f));
    float ra = clampf(y * rxGain, -1.0f, 1.0f);
    rxEnv += ENV_TRACK * (fabsf(ra) - rxEnv);
    rxEnvOut = rxEnv;
    if (fabsf(y) > rxPeak) rxPeak = fabsf(y);

    float out;
    int sink = rxSink;
    if (sink == 0) out = receiverGate.process(ra, rxEnv, rxNoiseFloor, rxGateOn);
    else if (sink == 1) { out = 0.5f * sinf(spkPhase); spkPhase += 2.0f*(float)M_PI*1000.0f/FS_HZ;
                          if (spkPhase > 6.2831853f) spkPhase -= 6.2831853f; }
    else out = 0;
    out *= vol;
#if ESP_ARDUINO_VERSION_MAJOR < 3
    // DAC1 is enabled once in setup, rather than on every write.
    dac_output_voltage(DAC_CHANNEL_1, (uint8_t)(128.0f + 127.0f * out));
#else
    dacWrite(PIN_DAC, (uint8_t)(128.0f + 127.0f * out));
#endif

    // TX: mic -> gate -> duck -> gain -> laser PWM
    float m = micLpf.process(micHpf.process(micDc.process((float)rawMic / 2048.0f)));
    micEnv += MIC_TRACK * (fabsf(m) - micEnv);
    if (micEnv > GATE_OPEN) gateOpenState = true; else if (micEnv < GATE_CLOSE) gateOpenState = false;
    float gTarget = (!gateOn || gateOpenState) ? 1.0f : 0.0f;
    gateG += MIC_TRACK * (gTarget - gateG);
    float dTarget = (duckOn && rxEnv > DUCK_THRESHOLD) ? DUCK_GAIN : 1.0f;
    duckG += ENV_TRACK * (dTarget - duckG);

    float duty = 0, t = 0;
    int src = txSrc;
    if (src == 4) {
      float driven = m * micGain * gateG * duckG;
      if (fabsf(driven) >= 1.0f) txClipSamples++;
      t = clampf(driven, -1.0f, 1.0f); duty = TX_BIAS + TX_DEPTH * t;
    }
    else if (src == 3) { t = 0.8f * sinf(tonePhase); tonePhase += 2.0f*(float)M_PI*1000.0f/FS_HZ;
                         if (tonePhase > 6.2831853f) tonePhase -= 6.2831853f; duty = TX_BIAS + TX_DEPTH * t; }
    else if (src == 2) { duty = (((tick / (FS_HZ / 4)) & 1) ? TX_BIAS + TX_DEPTH : TX_BIAS - TX_DEPTH); }
    else if (src == 1) duty = TX_BIAS;
    else duty = 0;
    duty = clampf(duty, 0.0f, 1.0f);
    laserWrite((uint32_t)(duty * (float)MAXD));
    tick++;

    uint32_t dt = (uint32_t)(esp_timer_get_time() - t0);
    workSum += dt; workCnt++;
    if (dt > workMax) workMax = dt;
    // Reserve a complete scheduler tick for Bluetooth and IDLE0. A one-tick
    // delay can expire at the next tick boundary before IDLE0 gets to run.
    // The pause is counted honestly as missed sample ticks.
    TickType_t nowTick = xTaskGetTickCount();
    if (nowTick - lastRecovery >= pdMS_TO_TICKS(100)) {
      vTaskDelay(2);
      lastRecovery = xTaskGetTickCount();
    }
  }
}

// ----------------------------------------------------------------- LoRa side (runs in loop(), core 1)
static bool     loraOk = false;
static bool     loraEnabled = true; // Restored pre-Wi-Fi behavior; z can pause LoRa.
static bool     statusLogsEnabled = true; // Restored USB dashboard reports; q can pause them.
static uint32_t lastTelemetryMs = 0;
static void handleJson(const char *line);
static uint32_t loraSeq = 0, lastHbMs = 0, lastPeerMs = 0, txCount = 0, rxCount = 0;
static int      lastRssi = 0; static float lastSnr = 0;
static char     lastPeer = '-'; static bool peerLaserUp = false;
static int      pathMode = 0;             // 0 AUTO, 1 force LASER, 2 force LORA
static bool     laserLinkUp = false;      // debounced laser link state
static bool     failover = false;         // true when the backup channel is the active path
static uint32_t calEndMs = 0, calCount = 0; static float calSum = 0;

static void loraSend(char type, const char *payload) {
  if (!loraOk || !loraEnabled) return;
  LoRa.beginPacket();
  LoRa.print("BB:"); LoRa.print(UNIT_ID); LoRa.print(':'); LoRa.print(type); LoRa.print(':'); LoRa.print(payload);
  LoRa.endPacket();                       // blocks until sent (tens of ms)
  txCount++;
}

static void loraHandle(char *buf) {       // buf = "BB:<id>:<type>:<payload>"
  if (strncmp(buf, "BB:", 3) != 0 || strlen(buf) < 7 || buf[4] != ':' || buf[6] != ':') return;
  char from = buf[3], type = buf[5]; const char *payload = buf + 7;
  if ((from != 'A' && from != 'B') || from == UNIT_ID) return;
  lastPeer = from; lastPeerMs = millis(); rxCount++;
  if (type == 'H') peerLaserUp = (strncmp(payload, "up", 2) == 0);
  else if (type == 'M') Serial.printf("[LORA MSG from %c rssi=%d snr=%.1f] %s\n", from, lastRssi, lastSnr, payload);
  else if (type == 'P') { char r[24]; snprintf(r, sizeof r, "%s", payload); loraSend('R', r); }
  else if (type == 'R') Serial.printf("[LORA PONG from %c seq=%s rssi=%d snr=%.1f]\n", from, payload, lastRssi, lastSnr);
  else if (type == 'C' && UNIT_ID == 'B' && from == 'A') handleJson(payload);
}

static void loraPoll() {
  if (!loraOk || !loraEnabled) return;
  int sz = LoRa.parsePacket();
  if (sz <= 0) return;
  char buf[256]; int n = 0;
  while (LoRa.available() && n < (int)sizeof(buf) - 1) buf[n++] = (char)LoRa.read();
  buf[n] = 0;
  lastRssi = LoRa.packetRssi(); lastSnr = LoRa.packetSnr();
  if (n >= 7 && UNIT_ID == 'A' && memcmp(buf, "BB:B:T:", 7) == 0) {
    JsonDocument status;
    if (!decodeTelemetry((const uint8_t *)buf + 7, n - 7, 'B', status)) return;
    lastPeer = 'B'; lastPeerMs = millis(); rxCount++;
    peerLaserUp = status["laser"] == 1;
    // Forward only newly received packets. Never keep an absent B artificially online.
    serializeJson(status, Serial); Serial.println();
    publishBluetooth(status);
    loraSend('H', laserLinkUp ? "up,0" : "down,0");
    return;
  }
  loraHandle(buf);
}

static void updatePath(uint32_t now) {
  // debounced laser-link detection from the receiver envelope
  float env = rxEnvOut;
  if (calEndMs) {                                   // calibration window
    calSum += env; calCount++;
    if (now >= calEndMs) {
      calEndMs = 0;
      float mean = calCount ? calSum / (float)calCount : 0;
      rxNoiseFloor = clampf(mean, 0.0005f, 0.3f);
      linkThresh = clampf(mean * 2.5f, 0.005f, 1.0f);
      linkDetector.reset(); laserLinkUp = false;
      Serial.printf("[CAL] noise mean=%.3f -> link threshold=%.3f\n", mean, (float)linkThresh);
    }
    return;
  }
  laserLinkUp = linkDetector.update(env, linkThresh, now);
  bool want = (pathMode == 2) ? true : (pathMode == 1) ? false : !laserLinkUp;
  if (want != failover) {
    failover = want;
    Serial.printf("[PATH] %s\n", failover ? "FAILOVER: LoRa is the active backup path" : "laser link is the active path");
    // B telemetry and A replies carry link state without competing heartbeats.
  }
}

// ----------------------------------------------------------------- serial input
static char lineBuf[48]; static int lineLen = 0; static bool lineMode = false;
static char jsonBuf[256];
static size_t jsonLen = 0;
static bool jsonMode = false, jsonOverflow = false;

// Backend protocol stays on loop/core 1; the audio task never prints JSON.
static void emitStatus(uint32_t now, bool oneShot = false) {
  const bool publishLora = UNIT_ID == 'B' && !oneShot && now - lastTelemetryMs >= 2000;
  if (!statusLogsEnabled && !oneShot && !publishLora && !bleConnected) return;
  JsonDocument d;
  char unit[2] = {UNIT_ID, 0}, peer[2] = {lastPeer, 0};
  d["t"] = "status"; d["unit"] = unit; d["up"] = now / 1000;
  d["fs"] = FS_HZ;
  d["laser"] = laserLinkUp ? 1 : 0; d["env"] = (float)rxEnvOut;
  d["thr"] = (float)linkThresh; d["mode"] = pathMode;
  d["audioV"] = 1;
  d["rxGate"] = rxGateOn ? 1 : 0;
  d["rxNoiseFloor"] = (float)rxNoiseFloor;
  d["failover"] = failover ? 1 : 0;
  d["tx"] = (int)txSrc; d["rx"] = (int)rxSink;
  d["vol"] = (float)vol; d["rxGain"] = (float)rxGain;
  d["micGain"] = (float)micGain;
  d["savedMicGain"] = hasSavedMicGain ? savedMicGain : -1.0f;
  d["duck"] = duckOn ? 1 : 0; d["gate"] = gateOn ? 1 : 0;
  d["micP2P"] = (int)(micMax - micMin);
  d["panP2P"] = (int)(panMax - panMin);
  d["micMin"] = (int)micMin; d["micMax"] = (int)micMax;
  d["panMin"] = (int)panMin; d["panMax"] = (int)panMax;
  d["adcErrors"] = (uint32_t)adcErrors;
  d["wifi"] = 0;
  // Cumulative counts: compare their increases between status reports.
  d["micSamples"] = (uint32_t)micSamples;
  d["micRailSamples"] = (uint32_t)micRailSamples;
  d["txClipSamples"] = (uint32_t)txClipSamples;
  uint32_t wc = workCnt;
  d["workAvg"] = wc ? workSum / wc : 0;
  d["workMax"] = (uint32_t)workMax; d["over"] = (uint32_t)overruns;
  d["cal"] = calEndMs ? 1 : 0;
  // This firmware has no battery measurement.
  d["batV"] = -1; d["batPct"] = -1;
  JsonObject l = d["lora"].to<JsonObject>();
  l["ok"] = loraOk ? 1 : 0; l["enabled"] = loraEnabled ? 1 : 0; l["peer"] = peer;
  l["peerLaser"] = peerLaserUp ? 1 : 0;
  l["ageS"] = lastPeerMs ? (long)((now - lastPeerMs) / 1000) : -1L;
  l["rssi"] = lastRssi; l["snr"] = lastSnr;
  l["tx"] = txCount; l["rx"] = rxCount;
  if (statusLogsEnabled || oneShot) { serializeJson(d, Serial); Serial.println(); }
  if (!oneShot) publishBluetooth(d);
  if (publishLora && loraOk && loraEnabled) {
    uint8_t packet[248];
    size_t length = encodeTelemetry(d, packet, sizeof(packet));
    if (length && LoRa.beginPacket()) {
      LoRa.print("BB:B:T:");
      LoRa.write(packet, length);
      LoRa.endPacket();
      txCount++;
      lastTelemetryMs = now;
    }
  }

}
static void help() {
  Serial.println(F("s one status report | q periodic USB logs on/off (ON at boot)"));
  Serial.println(F("S save current microphone gain for battery/reboot operation (G/g adjust)"));
  Serial.println(F("z radio on/off (diagnostic: stops LoRa TX/RX while off)"));
  Serial.println(F("TX src: 4 mic  3 tone  2 blink  1 steady  0 off | RX: p panel  k tone  x mute"));
  Serial.println(F("+/- volume  ]/[ rx gain  G/g mic gain  d duck  n gate"));
  Serial.println(F("l path mode (AUTO/LASER/LORA)  c calibrate link threshold  b LoRa ping  >text send LoRa message"));
}
static void handleKey(char c) {
  static uint32_t pingSeq = 0;
  if (c >= '0' && c <= '4') txSrc = c - '0';
  else if (c == 'p') rxSink = 0;
  else if (c == 'k') rxSink = 1;
  else if (c == 'x') rxSink = 2;
  else if (c == '+') vol = clampf(vol + 0.05f, 0.05f, 1.0f);
  else if (c == '-') vol = clampf(vol - 0.05f, 0.05f, 1.0f);
  else if (c == ']') rxGain = clampf(rxGain * 1.25f, 1.0f, 60.0f);
  else if (c == '[') rxGain = clampf(rxGain * 0.8f, 1.0f, 60.0f);
  else if (c == 'G') micGain = clampf(micGain * 1.25f, 0.5f, 30.0f);
  else if (c == 'g') micGain = clampf(micGain * 0.8f, 0.5f, 30.0f);
  else if (c == 'd') duckOn = !duckOn;
  else if (c == 'n') gateOn = !gateOn;
  else if (c == 'l') { pathMode = (pathMode + 1) % 3; Serial.printf("[PATH MODE] %s\n", pathMode == 0 ? "AUTO" : pathMode == 1 ? "force LASER" : "force LORA"); }
  else if (c == 'c') { calEndMs = millis() + 3000; calSum = 0; calCount = 0; Serial.println(F("[CAL] noise for 3 s: panel UNCOVERED in normal lighting; far laser OFF; stay quiet")); }
  else if (c == 'b') { char p[16]; snprintf(p, sizeof p, "%lu", (unsigned long)++pingSeq); loraSend('P', p); Serial.println(F("[LORA] ping sent")); }
  else if (c == 'z') {
    if (!loraOk) { Serial.println(F("[RADIO] unavailable: LoRa initialization failed")); return; }
    loraEnabled = !loraEnabled;
    if (loraEnabled) { LoRa.idle(); lastHbMs = millis(); }
    else LoRa.sleep();
    Serial.println(loraEnabled ? F("[RADIO] ON") : F("[RADIO] OFF: LoRa TX/RX stopped; laser audio continues"));
  }
  else if (c == 'q') {
    statusLogsEnabled = !statusLogsEnabled;
    Serial.println(statusLogsEnabled ? F("[LOGS] periodic USB status ON") : F("[LOGS] periodic USB status OFF; USB dashboard reports paused"));
  }
  else if (c == 's') emitStatus(millis(), true);
  else if (c == 'S') saveMicGain();
  else if (c == 'h') help();
}
static void handleJson(const char *line) {
  JsonDocument d;
  if (deserializeJson(d, line)) return;
  const char *target = d["target"] | "";
  if (*target && (target[1] || target[0] != UNIT_ID)) {
    if (UNIT_ID == 'A' && !strcmp(target, "B")) loraSend('C', line);
    return;
  }
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "set")) {
    const char *k = d["k"] | "";
    if (!d["v"].is<float>()) return;
    float v = d["v"].as<float>();
    if (!isfinite(v)) return;
    if (!strcmp(k, "txSrc")) txSrc = (int)clampf(v, 0, 4);
    else if (!strcmp(k, "rxSink")) rxSink = (int)clampf(v, 0, 2);
    else if (!strcmp(k, "vol")) vol = clampf(v, 0.05f, 1);
    else if (!strcmp(k, "rxGain")) rxGain = clampf(v, 1, 60);
    else if (!strcmp(k, "micGain")) micGain = clampf(v, 0.5f, 30);
    else if (!strcmp(k, "duck")) duckOn = v > 0;
    else if (!strcmp(k, "gate")) gateOn = v > 0;
    else if (!strcmp(k, "linkThresh")) {
      linkThresh = clampf(v, 0.005f, 1.0f);
      linkDetector.reset(); laserLinkUp = false;
    }
    else if (!strcmp(k, "rxGate")) rxGateOn = v > 0;
    else if (!strcmp(k, "rxNoiseFloor")) rxNoiseFloor = clampf(v, 0.0005f, 0.3f);
  } else if (!strcmp(cmd, "mode")) pathMode = constrain((int)(d["v"] | 0), 0, 2);
  else if (!strcmp(cmd, "cal")) handleKey('c');
  else if (!strcmp(cmd, "ping")) handleKey('b');
  else if (!strcmp(cmd, "msg")) {
    const char *text = d["text"] | "";
    if (*text) loraSend('M', text);
  }
}

static void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (jsonMode) {
      if (c == '\n' || c == '\r') {
        jsonBuf[jsonLen] = 0;
        if (!jsonOverflow) handleJson(jsonBuf);
        jsonMode = false; jsonLen = 0; jsonOverflow = false;
      } else if (jsonLen < sizeof(jsonBuf) - 1) jsonBuf[jsonLen++] = c;
      else jsonOverflow = true; // Discard remainder; never interpret it as keys.
    } else if (lineMode) {
      if (c == '\n' || c == '\r') { lineBuf[lineLen] = 0; if (lineLen) { loraSend('M', lineBuf); Serial.printf("[LORA] sent: %s\n", lineBuf); } lineMode = false; lineLen = 0; }
      else if (lineLen < (int)sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
    } else if (c == '{') { jsonMode = true; jsonLen = 1; jsonBuf[0] = c; }
    else if (c == '>') { lineMode = true; lineLen = 0; }
    else handleKey(c);
  }
}

// ----------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  delay(300);
  loadMicGain();
  pinMode(PIN_LED, OUTPUT);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
#if ESP_ARDUINO_VERSION_MAJOR < 3
  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC1_CHANNEL_7, ADC_ATTEN_DB_12); // GPIO35 panel
  adc2_config_channel_atten(ADC2_CHANNEL_4, ADC_ATTEN_DB_12); // GPIO13 microphone
  adc_power_acquire(); // Keep the ADC powered during continuous audio sampling.
  dac_output_enable(DAC_CHANNEL_1);
#endif
  laserInit();
  laserWrite((uint32_t)(TX_BIAS * (float)MAXD));
  dacWrite(PIN_DAC, 128);
  rxHpf.highpass((float)FS_HZ, RX_HPF_HZ);
  rxLpf.lowpass((float)FS_HZ, 2000.0f);
  micHpf.highpass((float)FS_HZ, 250.0f);
  micLpf.lowpass((float)FS_HZ, 2000.0f);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  loraOk = LoRa.begin(LORA_FREQ);
  if (loraOk) {
    LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
    LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_POWER);
    Serial.printf("LoRa OK: %.1f MHz SF%d BW%.0fkHz unit %c\n", LORA_FREQ / 1e6, LORA_SF, LORA_BW / 1e3, UNIT_ID);
    if (!loraEnabled) {
      LoRa.sleep();
      Serial.println(F("[RADIO] OFF at boot for audio recovery; z enables LoRa"));
    }
  } else {
    Serial.println(F("LoRa FAILED to start: check 3.3 V, SPI wires, NSS/RST/DIO0 pins and the band. Laser audio still runs."));
  }

  // Initialize BLE before starting the high-rate sampler. Preserve the original
  // cross-core timer notification layout; give audio priority and timing margin.
  if (UNIT_ID == 'A') {
    Serial.println(startBluetoothGateway() ? F("[BLE] BeamBi-A ready; Wi-Fi OFF; GPIO13 enabled")
                                          : F("[BLE] gateway startup FAILED"));
  }
  xTaskCreatePinnedToCore(sampleLoop, "sample", 4096, nullptr, configMAX_PRIORITIES - 2, &sampleTask, 0);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  sampleTimer = timerBegin(1000000);
  timerAttachInterrupt(sampleTimer, &onSampleTimer);
  timerAlarm(sampleTimer, 1000000 / FS_HZ, true, 0);
#else
  sampleTimer = timerBegin(0, 80, true);
  timerAttachInterrupt(sampleTimer, &onSampleTimer, true);
  timerAlarmWrite(sampleTimer, 1000000 / FS_HZ, true);
  timerAlarmEnable(sampleTimer);
#endif
  Serial.println(F("BeamBi unit + LoRa backup. Send h for commands."));
  Serial.println(F("[LOGS] periodic USB output ON; s=one report, q=toggle periodic reports"));
  Serial.printf("[WIRING] unit %c: microphone OUT GPIO13; panel GPIO35; sample rate %d Hz\n", UNIT_ID, FS_HZ);
  Serial.println(F("[GATEWAY] A forwards B LoRa status over Bluetooth (USB optional)"));
}

void loop() {
  static uint32_t last = 0;
  uint32_t now = millis();
  serialPoll();
  if (bleCommands) {
    BleCommand command;
    for (int i = 0; i < 20 && xQueueReceive(bleCommands, &command, 0) == pdTRUE; ++i)
      handleJson(command.json);
  }
  loraPoll();
  updatePath(now);

  digitalWrite(PIN_LED, laserLinkUp ? HIGH : LOW);

  if (now - last >= 1000) {
    last = now;
    emitStatus(now);
    micMin = 4095; micMax = 0; panMin = 4095; panMax = 0; panSum = 0; panCnt = 0;
    rxPeak = 0; workSum = 0; workCnt = 0; workMax = 0;
  }
  delay(5);
}
