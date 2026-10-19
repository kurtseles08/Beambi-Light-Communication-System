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
 *   - LoRa heartbeat every 2 s (1 s in failover) carrying the unit's laser-link state
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
 * STATUS: not run on hardware. Set UNIT_ID to a different letter on each unit.
 */
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include <SPI.h>
#include <LoRa.h>

// ----------------------------------------------------------------- pins
constexpr int PIN_MIC = 13, PIN_PANEL = 35, PIN_LASER = 27, PIN_DAC = 25, PIN_LED = 2;
constexpr int LORA_SS = 5, LORA_RST = 14, LORA_DIO0 = 26;   // SCK 18, MISO 19, MOSI 23 are the default SPI pins

// ----------------------------------------------------------------- LoRa settings (must match on every node)
constexpr char     UNIT_ID    = 'A';        // A on one unit, B on the other
constexpr long     LORA_FREQ  = 433E6;      // SET TO YOUR MODULE'S BAND (433E6, 868E6, 915E6) AND LOCAL RULES
constexpr int      LORA_SF    = 7;          // 7 = fastest, 12 = longest range
constexpr long     LORA_BW    = 125E3;
constexpr int      LORA_CR    = 5;          // 4/5
constexpr int      LORA_POWER = 14;         // dBm
constexpr int      LORA_SYNC  = 0xB1;
constexpr uint32_t HB_MS = 2000, HB_FAILOVER_MS = 1000;
constexpr uint32_t LINK_UP_MS = 500, LINK_DOWN_MS = 3000;

// ----------------------------------------------------------------- audio tunables
constexpr int      FS_HZ          = 8000;
constexpr uint32_t LASER_PWM_HZ   = 80000;
constexpr int      LASER_PWM_BITS = 9;
constexpr float TX_BIAS  = 0.50f;
constexpr float TX_DEPTH = 0.40f;
constexpr float RX_HPF_HZ = 250.0f;
constexpr float DC_TRACK  = 0.001f;
constexpr float GATE_OPEN = 0.020f, GATE_CLOSE = 0.010f;
constexpr float DUCK_THRESHOLD = 0.05f, DUCK_GAIN = 0.25f;

// ----------------------------------------------------------------- runtime settings
static volatile int   txSrc = 4;
static volatile int   rxSink = 0;
static volatile float micGain = 4.0f;
static volatile float rxGain = 8.0f;
static volatile float vol = 0.60f;
static volatile bool  duckOn = false;
static volatile bool  gateOn = false;
static volatile float linkThresh = 0.10f;   // use key c to calibrate

// ----------------------------------------------------------------- DSP helpers
struct DcBlocker { float x1 = 0, y1 = 0;
  float process(float x) { float y = x - x1 + 0.995f * y1; x1 = x; y1 = y; return y; } };
struct Biquad { float b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
  float process(float x) { float y=b0*x+z1; z1=b1*x-a1*y+z2; z2=b2*x-a2*y; return y; }
  void highpass(float fs, float fc, float q=0.7071f) {
    float w0=2.0f*(float)M_PI*fc/fs, cs=cosf(w0), al=sinf(w0)/(2.0f*q), a0=1.0f+al;
    b0=((1.0f+cs)*0.5f)/a0; b1=-(1.0f+cs)/a0; b2=b0; a1=(-2.0f*cs)/a0; a2=(1.0f-al)/a0; } };
static inline float clampf(float v, float lo, float hi) { return v<lo?lo:(v>hi?hi:v); }

// ----------------------------------------------------------------- state
static TaskHandle_t sampleTask = nullptr;
static hw_timer_t  *sampleTimer = nullptr;
static DcBlocker micDc;
static Biquad    rxHpf;
static float rxDc = 1875.0f, rxEnv = 0, micEnv = 0, gateG = 1, duckG = 1;
static bool  gateOpenState = false;
static float tonePhase = 0, spkPhase = 0;
static uint32_t tick = 0;

static volatile float rxEnvOut = 0, rxPeak = 0;
static volatile int   micMin = 4095, micMax = 0, panMin = 4095, panMax = 0;
static volatile uint32_t panSum = 0, panCnt = 0;
static volatile uint32_t overruns = 0, workMax = 0, workSum = 0, workCnt = 0;
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

// ----------------------------------------------------------------- 8 kHz sample task (core 0)
static void sampleLoop(void *) {
  for (;;) {
    uint32_t n = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    if (n > 1) { overruns += n - 1; vTaskDelay(1); }   // safety: lets the idle task run
    int64_t t0 = esp_timer_get_time();

    int rawMic = analogRead(PIN_MIC);
    int rawPan = analogRead(PIN_PANEL);

    if (rawMic < micMin) micMin = rawMic;
    if (rawMic > micMax) micMax = rawMic;
    if (rawPan < panMin) panMin = rawPan;
    if (rawPan > panMax) panMax = rawPan;
    panSum += rawPan; panCnt++;

    // RX: panel -> DC track -> HPF -> gain -> speaker
    rxDc += DC_TRACK * ((float)rawPan - rxDc);
    float y = rxHpf.process(((float)rawPan - rxDc) / 2048.0f);
    float ra = clampf(y * rxGain, -1.0f, 1.0f);
    rxEnv += 0.002f * (fabsf(ra) - rxEnv);
    rxEnvOut = rxEnv;
    if (fabsf(y) > rxPeak) rxPeak = fabsf(y);

    float out;
    int sink = rxSink;
    if (sink == 0) out = ra;
    else if (sink == 1) { out = 0.5f * sinf(spkPhase); spkPhase += 2.0f*(float)M_PI*1000.0f/FS_HZ;
                          if (spkPhase > 6.2831853f) spkPhase -= 6.2831853f; }
    else out = 0;
    out *= vol;
    dacWrite(PIN_DAC, (uint8_t)(128.0f + 127.0f * out));

    // TX: mic -> gate -> duck -> gain -> laser PWM
    float m = micDc.process((float)rawMic / 2048.0f);
    micEnv += 0.01f * (fabsf(m) - micEnv);
    if (micEnv > GATE_OPEN) gateOpenState = true; else if (micEnv < GATE_CLOSE) gateOpenState = false;
    float gTarget = (!gateOn || gateOpenState) ? 1.0f : 0.0f;
    gateG += 0.01f * (gTarget - gateG);
    float dTarget = (duckOn && rxEnv > DUCK_THRESHOLD) ? DUCK_GAIN : 1.0f;
    duckG += 0.002f * (dTarget - duckG);

    float duty = 0, t = 0;
    int src = txSrc;
    if (src == 4) { t = clampf(m * micGain * gateG * duckG, -1.0f, 1.0f); duty = TX_BIAS + TX_DEPTH * t; }
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
  }
}

// ----------------------------------------------------------------- LoRa side (runs in loop(), core 1)
static bool     loraOk = false;
static uint32_t loraSeq = 0, lastHbMs = 0, lastPeerMs = 0, txCount = 0, rxCount = 0;
static int      lastRssi = 0; static float lastSnr = 0;
static char     lastPeer = '-'; static bool peerLaserUp = false;
static int      pathMode = 0;             // 0 AUTO, 1 force LASER, 2 force LORA
static bool     laserLinkUp = false;      // debounced laser link state
static bool     failover = false;         // true when the backup channel is the active path
static uint32_t aboveSince = 0, belowSince = 0, calEndMs = 0, calCount = 0; static float calSum = 0;

static void loraSend(char type, const char *payload) {
  if (!loraOk) return;
  LoRa.beginPacket();
  LoRa.print("BB:"); LoRa.print(UNIT_ID); LoRa.print(':'); LoRa.print(type); LoRa.print(':'); LoRa.print(payload);
  LoRa.endPacket();                       // blocks until sent (tens of ms)
  txCount++;
}

static void loraHandle(char *buf) {       // buf = "BB:<id>:<type>:<payload>"
  if (strncmp(buf, "BB:", 3) != 0 || strlen(buf) < 7 || buf[4] != ':' || buf[6] != ':') return;
  char from = buf[3], type = buf[5]; const char *payload = buf + 7;
  if (from == UNIT_ID) return;
  lastPeer = from; lastPeerMs = millis(); rxCount++;
  if (type == 'H') peerLaserUp = (strncmp(payload, "up", 2) == 0);
  else if (type == 'M') Serial.printf("[LORA MSG from %c rssi=%d snr=%.1f] %s\n", from, lastRssi, lastSnr, payload);
  else if (type == 'P') { char r[24]; snprintf(r, sizeof r, "%s", payload); loraSend('R', r); }
  else if (type == 'R') Serial.printf("[LORA PONG from %c seq=%s rssi=%d snr=%.1f]\n", from, payload, lastRssi, lastSnr);
}

static void loraPoll() {
  if (!loraOk) return;
  int sz = LoRa.parsePacket();
  if (sz <= 0) return;
  char buf[80]; int n = 0;
  while (LoRa.available() && n < (int)sizeof(buf) - 1) buf[n++] = (char)LoRa.read();
  buf[n] = 0;
  lastRssi = LoRa.packetRssi(); lastSnr = LoRa.packetSnr();
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
      linkThresh = fmaxf(mean * 2.0f, 0.02f);
      Serial.printf("[CAL] noise mean=%.3f -> link threshold=%.3f\n", mean, (float)linkThresh);
    }
    return;
  }
  if (env > linkThresh) { belowSince = 0; if (!aboveSince) aboveSince = now; if (now - aboveSince >= LINK_UP_MS) laserLinkUp = true; }
  else                  { aboveSince = 0; if (!belowSince) belowSince = now; if (now - belowSince >= LINK_DOWN_MS) laserLinkUp = false; }
  bool want = (pathMode == 2) ? true : (pathMode == 1) ? false : !laserLinkUp;
  if (want != failover) {
    failover = want;
    Serial.printf("[PATH] %s\n", failover ? "FAILOVER: LoRa is the active backup path" : "laser link is the active path");
    loraSend('H', failover ? "FO,0" : "up,0");     // tell the peer right away
  }
}

// ----------------------------------------------------------------- serial input
static char lineBuf[48]; static int lineLen = 0; static bool lineMode = false;
static void help() {
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
  else if (c == 'c') { calEndMs = millis() + 3000; calSum = 0; calCount = 0; Serial.println(F("[CAL] measuring noise for 3 s: cover the panel, laser off at the far end")); }
  else if (c == 'b') { char p[16]; snprintf(p, sizeof p, "%lu", (unsigned long)++pingSeq); loraSend('P', p); Serial.println(F("[LORA] ping sent")); }
  else if (c == 'h') help();
}
static void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (lineMode) {
      if (c == '\n' || c == '\r') { lineBuf[lineLen] = 0; if (lineLen) { loraSend('M', lineBuf); Serial.printf("[LORA] sent: %s\n", lineBuf); } lineMode = false; lineLen = 0; }
      else if (lineLen < (int)sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
    } else if (c == '>') { lineMode = true; lineLen = 0; }
    else handleKey(c);
  }
}

// ----------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_LED, OUTPUT);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  laserInit();
  laserWrite((uint32_t)(TX_BIAS * (float)MAXD));
  dacWrite(PIN_DAC, 128);
  rxHpf.highpass((float)FS_HZ, RX_HPF_HZ);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  loraOk = LoRa.begin(LORA_FREQ);
  if (loraOk) {
    LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
    LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_POWER);
    Serial.printf("LoRa OK: %.1f MHz SF%d BW%.0fkHz unit %c\n", LORA_FREQ / 1e6, LORA_SF, LORA_BW / 1e3, UNIT_ID);
  } else {
    Serial.println(F("LoRa FAILED to start: check 3.3 V, SPI wires, NSS/RST/DIO0 pins and the band. Laser audio still runs."));
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
}

void loop() {
  static uint32_t last = 0;
  uint32_t now = millis();
  serialPoll();
  loraPoll();
  updatePath(now);

  if (loraOk && now - lastHbMs >= (failover ? HB_FAILOVER_MS : HB_MS)) {
    lastHbMs = now;
    char p[24]; snprintf(p, sizeof p, "%s,%u", failover ? "FO" : (laserLinkUp ? "up" : "down"), (unsigned)(rxEnvOut * 1000));
    loraSend('H', p);
  }
  digitalWrite(PIN_LED, laserLinkUp ? HIGH : LOW);

  if (now - last >= 1000) {
    last = now;
    static const char *SRC[] = {"OFF", "STEADY", "BLINK", "TONE", "MIC"};
    static const char *SNK[] = {"PANEL", "TONE", "MUTE"};
    uint32_t pc = panCnt, wc = workCnt;
    Serial.printf("[TX %s mic p2p=%d g=%.1f] [RX %s panel p2p=%d env=%.3f thr=%.3f laser=%s gain=%.1f vol=%.2f] work=%u/%u us over=%u",
      SRC[txSrc], micMax - micMin, (float)micGain, SNK[rxSink], panMax - panMin,
      (float)rxEnvOut, (float)linkThresh, laserLinkUp ? "UP" : "down", (float)rxGain, (float)vol,
      wc ? (unsigned)(workSum / wc) : 0, (unsigned)workMax, (unsigned)overruns);
    if (loraOk) Serial.printf(" | LORA %s peer=%c %s %lus ago rssi=%d tx=%u rx=%u",
      failover ? "ACTIVE" : "standby", lastPeer, peerLaserUp ? "laser-up" : "laser-down",
      lastPeerMs ? (unsigned long)((now - lastPeerMs) / 1000) : 0UL, lastRssi, (unsigned)txCount, (unsigned)rxCount);
    Serial.println();
    (void)pc;
    micMin = 4095; micMax = 0; panMin = 4095; panMax = 0; panSum = 0; panCnt = 0;
    rxPeak = 0; workSum = 0; workCnt = 0; workMax = 0;
  }
  delay(5);
}