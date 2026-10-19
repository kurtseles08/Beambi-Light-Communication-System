/*
 * BeamBi unit: laser audio link + LoRa backup + Wi-Fi/serial JSON interface for the dashboard.
 * PlatformIO project (src/main.cpp). Needs include/secrets.h and the libraries in platformio.ini.
 * Change UNIT_ID below to 'A' on one unit and 'B' on the other BEFORE uploading.
 *
 * Serial protocol (115200 baud, one message per line):
 *   OUT  {"t":"hello"...} {"t":"status"...} {"t":"event"...} {"t":"lora_msg"...} {"t":"pong"...} {"t":"cal"...}
 *   OUT  lines starting with '#' are human debug text (the backend ignores them)
 *   IN   {"cmd":"set","k":"vol","v":0.3}  {"cmd":"mode","v":0}  {"cmd":"cal"}  {"cmd":"ping"}  {"cmd":"msg","text":"hi"}
 *   IN   old single-key commands and >text still work from the serial monitor
 */
#include <Arduino.h>
#include <math.h>
#include <string.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>

#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include "secrets.h"

#if ESP_ARDUINO_VERSION_MAJOR < 3
  #include <driver/adc.h>
  #include <driver/dac.h>
#endif

// ----------------------------------------------------------------- pins
constexpr int PIN_MIC = 32, PIN_PANEL = 35, PIN_LASER = 27, PIN_DAC = 25, PIN_LED = 2, PIN_BAT = 34;
constexpr int LORA_SS = 5, LORA_RST = 14, LORA_DIO0 = 26;   // SCK 18, MISO 19, MOSI 23 are the default SPI pins

// ----------------------------------------------------------------- LoRa settings (must match on every node)
constexpr char     UNIT_ID    = 'A';        // A on one unit, B on the other
constexpr long     LORA_FREQ  = 433E6;      // SX1278 = 433 MHz band. Check local (NTC) rules.
constexpr int      LORA_SF    = 7;
constexpr long     LORA_BW    = 125E3;
constexpr int      LORA_CR    = 5;
constexpr int      LORA_POWER = 14;
constexpr int      LORA_SYNC  = 0xB1;
constexpr uint32_t HB_MS = 2000, HB_FAILOVER_MS = 1000;
constexpr uint32_t LINK_UP_MS = 500, LINK_DOWN_MS = 3000;

constexpr char FW_VERSION[] = "0.3-wifi";

constexpr float PILOT_HZ  = 1000.0f;   // must be bin-aligned: PILOT_HZ * GZ_N / FS_HZ = 25
constexpr float PILOT_AMP = 0.12f;     // pilot depth in the TX signal (0..1)
constexpr int   GZ_N      = 200;       // 25 ms block
constexpr float GZ_COEFF  = 1.41421356f; // 2*cos(2*pi*25/200)
static float pilotPhase = 0, gz1 = 0, gz2 = 0;
static int   gzN = 0;
static volatile float pilotEnvOut = 0;

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
static volatile float linkThresh = 0.10f;

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
static volatile uint32_t tAdcSum = 0, tDacSum = 0;     // timing diagnostics (microseconds, summed per second)
static const uint32_t MAXD = (1u << LASER_PWM_BITS) - 1;

// ----------------------------------------------------------------- battery: 9V alkaline on PIN_BAT through 330k / 100k
constexpr bool  HAVE_BATTERY = false;  // set true ONLY on a unit that has the divider wired to GPIO 34
constexpr float BAT_DIV      = 4.3f;   // (330k + 100k) / 100k
static volatile float batMv = 0;       // filtered millivolts at the pin, written by the sample task

static float batVolts() { return (HAVE_BATTERY && batMv > 0) ? (batMv / 1000.0f) * BAT_DIV : -1.0f; }
static int batPercent(float v) {       // 9V alkaline under load, rough
  static const float V[] = {6.0f, 6.6f, 7.2f, 7.8f, 8.4f, 9.0f};
  static const int   P[] = {0, 10, 25, 50, 75, 100};
  if (v <= V[0]) return 0;
  if (v >= V[5]) return 100;
  for (int i = 1; i < 6; i++)
    if (v <= V[i]) return (int)(P[i-1] + (P[i] - P[i-1]) * (v - V[i-1]) / (V[i] - V[i-1]));
  return 100;
}

// ----------------------------------------------------------------- hardware access (fast paths on Arduino core 2.x)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  static inline void laserInit() { ledcAttach(PIN_LASER, LASER_PWM_HZ, LASER_PWM_BITS); }
  static inline void laserWrite(uint32_t d) { ledcWrite(PIN_LASER, d); }
  static inline void adcInit() { analogReadResolution(12); analogSetAttenuation(ADC_11db); }
  static inline int  adcMic()   { return analogRead(PIN_MIC); }
  static inline int  adcPanel() { return analogRead(PIN_PANEL); }
  static inline void dacInit()  { dacWrite(PIN_DAC, 128); }
  static inline void dacOut(uint8_t v) { dacWrite(PIN_DAC, v); }
#else
  static inline void laserInit() { ledcSetup(0, LASER_PWM_HZ, LASER_PWM_BITS); ledcAttachPin(PIN_LASER, 0); }
  static inline void laserWrite(uint32_t d) { ledcWrite(0, d); }
  // Direct driver calls skip the slow analogRead() wrapper. GPIO32 = ADC1_CH4, GPIO35 = ADC1_CH7, DAC1 = GPIO25.
  static inline void adcInit() {
    analogReadResolution(12); analogSetAttenuation(ADC_11db);   // still used by analogReadMilliVolts (battery)
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ADC1_CHANNEL_4, ADC_ATTEN_DB_11);
    adc1_config_channel_atten(ADC1_CHANNEL_7, ADC_ATTEN_DB_11);
  }
  static inline int  adcMic()   { return adc1_get_raw(ADC1_CHANNEL_4); }
  static inline int  adcPanel() { return adc1_get_raw(ADC1_CHANNEL_7); }
  static inline void dacInit()  { dac_output_enable(DAC_CHANNEL_1); dac_output_voltage(DAC_CHANNEL_1, 128); }
  static inline void dacOut(uint8_t v) { dac_output_voltage(DAC_CHANNEL_1, v); }
#endif

void IRAM_ATTR onSampleTimer() {
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(sampleTask, &woken);
  if (woken) portYIELD_FROM_ISR();
}

// ----------------------------------------------------------------- 8 kHz sample task (core 0). NEVER print from here.
static void sampleLoop(void *) {
  for (;;) {
    uint32_t n = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    if (n > 1) { overruns += n - 1; vTaskDelay(1); }   // yield so the idle task and Wi-Fi can run
    int64_t t0 = esp_timer_get_time();

    int rawMic = adcMic();
    int rawPan = adcPanel();
    int64_t t1 = esp_timer_get_time();

    if (rawMic < micMin) micMin = rawMic;
    if (rawMic > micMax) micMax = rawMic;
    if (rawPan < panMin) panMin = rawPan;
    if (rawPan > panMax) panMax = rawPan;
    panSum += rawPan; panCnt++;

    rxDc += DC_TRACK * ((float)rawPan - rxDc);
    float y = rxHpf.process(((float)rawPan - rxDc) / 2048.0f);
    float gs = y + GZ_COEFF * gz1 - gz2; gz2 = gz1; gz1 = gs;
    if (++gzN >= GZ_N) {
      float p = gz1*gz1 + gz2*gz2 - GZ_COEFF*gz1*gz2;
      float amp = 2.0f * sqrtf(fmaxf(p, 0.0f)) / GZ_N;          // pilot amplitude, full-scale units
      pilotEnvOut += 0.4f * (clampf(amp * rxGain, 0.0f, 1.0f) - pilotEnvOut);
      gz1 = gz2 = 0; gzN = 0;
    }

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
    int64_t t2 = esp_timer_get_time();
    dacOut((uint8_t)(128.0f + 127.0f * out));
    int64_t t3 = esp_timer_get_time();

    float m = micDc.process((float)rawMic / 2048.0f);
    micEnv += 0.01f * (fabsf(m) - micEnv);
    if (micEnv > GATE_OPEN) gateOpenState = true; else if (micEnv < GATE_CLOSE) gateOpenState = false;
    float gTarget = (!gateOn || gateOpenState) ? 1.0f : 0.0f;
    gateG += 0.01f * (gTarget - gateG);
    float dTarget = (duckOn && rxEnv > DUCK_THRESHOLD) ? DUCK_GAIN : 1.0f;
    duckG += 0.002f * (dTarget - duckG);

    float duty = 0, t = 0;
    int src = txSrc;
    if (src == 4) {
      pilotPhase += 2.0f*(float)M_PI*PILOT_HZ/FS_HZ; if (pilotPhase > 6.2831853f) pilotPhase -= 6.2831853f;
      t = clampf(m * micGain * gateG * duckG + PILOT_AMP * sinf(pilotPhase), -1.0f, 1.0f);
      duty = TX_BIAS + TX_DEPTH * t;
    }
    else if (src == 3) { t = 0.8f * sinf(tonePhase); tonePhase += 2.0f*(float)M_PI*1000.0f/FS_HZ;
                         if (tonePhase > 6.2831853f) tonePhase -= 6.2831853f; duty = TX_BIAS + TX_DEPTH * t; }
    else if (src == 2) { duty = (((tick / (FS_HZ / 4)) & 1) ? TX_BIAS + TX_DEPTH : TX_BIAS - TX_DEPTH); }
    else if (src == 1) duty = TX_BIAS;
    else duty = 0;
    duty = clampf(duty, 0.0f, 1.0f);
    laserWrite((uint32_t)(duty * (float)MAXD));
    tick++;

    if (HAVE_BATTERY && (tick & 0x3FF) == 0) {   // about every 128 ms, ADC only used from this task
      float mv = (float)analogReadMilliVolts(PIN_BAT);
      batMv = (batMv == 0) ? mv : batMv + 0.1f * (mv - batMv);
    }

    uint32_t dt = (uint32_t)(esp_timer_get_time() - t0);
    workSum += dt; workCnt++;
    tAdcSum += (uint32_t)(t1 - t0);
    tDacSum += (uint32_t)(t3 - t2);
    if (dt > workMax) workMax = dt;
  }
}

// ----------------------------------------------------------------- JSON output helpers (loop() / core 1 only)
static void printJsonStr(const char *s) {
  Serial.print('"');
  for (; *s; s++) {
    char c = *s;
    if (c == '"' || c == '\\') { Serial.print('\\'); Serial.print(c); }
    else if ((uint8_t)c < 0x20) Serial.print(' ');
    else Serial.print(c);
  }
  Serial.print('"');
}

// ----------------------------------------------------------------- Wi-Fi reporting (own task, never touches the audio task)
struct NetMsg { char s[520]; };
struct CmdMsg { char s[160]; };
static QueueHandle_t netQ = nullptr, cmdQ = nullptr;
static Preferences prefs;

static void netPush(const char *json) {          // queue one JSON line for the Wi-Fi task
  if (!netQ) return;
  NetMsg m; strlcpy(m.s, json, sizeof m.s);
  xQueueSend(netQ, &m, 0);                       // queue full: drop, the next status replaces it
}

static bool netPost(const char *json) {
  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/api/device";
  if (!http.begin(url)) return false;
  http.setTimeout(2000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.POST((uint8_t *)json, strlen(json));
  static int lastCode = 0;
  if (code != lastCode) { lastCode = code; Serial.print(F("# NET post -> ")); Serial.println(code); }
  if (code == 200) {
    JsonDocument d;
    if (!deserializeJson(d, http.getString())) {
      for (JsonObject c : d["cmds"].as<JsonArray>()) {   // commands from the dashboard
        CmdMsg m; serializeJson(c, m.s, sizeof m.s);
        xQueueSend(cmdQ, &m, 0);
      }
    }
  }
  http.end();
  return code == 200;
}

static void netTask(void *) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  bool wasUp = false, sayHello = true;
  uint32_t lastTry = millis();
  for (;;) {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up != wasUp) {
      wasUp = up;
      if (up) { Serial.print(F("# WIFI connected, IP ")); Serial.println(WiFi.localIP()); sayHello = true; }
      else Serial.println(F("# WIFI lost, retrying"));
    }
    if (!up) {
      if (millis() - lastTry > 15000) { lastTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (sayHello) {                               // announce the unit, so the dashboard logs it
      JsonDocument d; char u[2] = {UNIT_ID, 0};
      d["t"] = "hello"; d["unit"] = u; d["fw"] = FW_VERSION;
      char h[96]; serializeJson(d, h, sizeof h);
      if (netPost(h)) { sayHello = false; xQueueReset(netQ); }
      else { vTaskDelay(pdMS_TO_TICKS(2000)); continue; }
    }
    NetMsg m;
    if (xQueueReceive(netQ, &m, pdMS_TO_TICKS(500)) == pdTRUE) {
      if (!netPost(m.s)) sayHello = true;
    }
  }
}

// ----------------------------------------------------------------- LoRa side
static bool     loraOk = false;
static uint32_t lastHbMs = 0, lastPeerMs = 0, txCount = 0, rxCount = 0;
static int      lastRssi = 0; static float lastSnr = 0;
static char     lastPeer = '-'; static bool peerLaserUp = false;
static int      pathMode = 0;             // 0 AUTO, 1 force LASER, 2 force LORA
static bool     laserLinkUp = false;
static bool     failover = false;
static uint32_t aboveSince = 0, belowSince = 0, calEndMs = 0, calCount = 0; static float calSum = 0;
static bool     forceStatus = false;      // set after a command so the dashboard updates immediately

static void loraSend(char type, const char *payload) {
  if (!loraOk) return;
  LoRa.beginPacket();
  LoRa.print("BB:"); LoRa.print(UNIT_ID); LoRa.print(':'); LoRa.print(type); LoRa.print(':'); LoRa.print(payload);
  LoRa.endPacket();
  txCount++;
}

static void netPushMsg(char from, const char *text) {
  JsonDocument d; char u[2] = {UNIT_ID, 0}, f[2] = {from, 0};
  d["t"] = "lora_msg"; d["unit"] = u; d["from"] = f; d["rssi"] = lastRssi; d["snr"] = lastSnr; d["text"] = text;
  char out[300]; serializeJson(d, out, sizeof out); netPush(out);
}
static void netPushPong(char from, const char *seq) {
  JsonDocument d; char u[2] = {UNIT_ID, 0}, f[2] = {from, 0};
  d["t"] = "pong"; d["unit"] = u; d["from"] = f; d["seq"] = seq; d["rssi"] = lastRssi; d["snr"] = lastSnr;
  char out[200]; serializeJson(d, out, sizeof out); netPush(out);
}

static void loraHandle(char *buf) {
  if (strncmp(buf, "BB:", 3) != 0 || strlen(buf) < 7 || buf[4] != ':' || buf[6] != ':') return;
  char from = buf[3], type = buf[5]; const char *payload = buf + 7;
  if (from == UNIT_ID) return;
  lastPeer = from; lastPeerMs = millis(); rxCount++;
  if (type == 'H') peerLaserUp = (strncmp(payload, "up", 2) == 0);
  else if (type == 'M') {
    Serial.printf("{\"t\":\"lora_msg\",\"from\":\"%c\",\"rssi\":%d,\"snr\":%.1f,\"text\":", from, lastRssi, lastSnr);
    netPushMsg(from, payload);
    printJsonStr(payload); Serial.println('}');
  }
  else if (type == 'P') { char r[24]; snprintf(r, sizeof r, "%s", payload); loraSend('R', r); }
  else if (type == 'R') {
    Serial.printf("{\"t\":\"pong\",\"from\":\"%c\",\"seq\":\"%s\",\"rssi\":%d,\"snr\":%.1f}\n", from, payload, lastRssi, lastSnr);
    netPushPong(from, payload);
  }
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
  float env = pilotEnvOut;
  if (calEndMs) {
    calSum += env; calCount++;
    if (now >= calEndMs) {
      calEndMs = 0;
      float mean = calCount ? calSum / (float)calCount : 0;
      linkThresh = fmaxf(mean * 2.0f, 0.02f);
      prefs.putFloat("thr", (float)linkThresh);   // survive a reboot (battery swap, power loss)
      { JsonDocument d; char u[2] = {UNIT_ID, 0}; d["t"] = "cal"; d["unit"] = u; d["mean"] = mean; d["thr"] = (float)linkThresh;
        char o[120]; serializeJson(d, o, sizeof o); netPush(o); }
      Serial.printf("{\"t\":\"cal\",\"mean\":%.4f,\"thr\":%.4f}\n", mean, (float)linkThresh);
      forceStatus = true;
    }
    return;
  }
  if (env > linkThresh) { belowSince = 0; if (!aboveSince) aboveSince = now; if (now - aboveSince >= LINK_UP_MS) laserLinkUp = true; }
  else                  { aboveSince = 0; if (!belowSince) belowSince = now; if (now - belowSince >= LINK_DOWN_MS) laserLinkUp = false; }
  bool want = (pathMode == 2) ? true : (pathMode == 1) ? false : !laserLinkUp;
  if (want != failover) {
    failover = want;
    Serial.printf("{\"t\":\"event\",\"k\":\"path\",\"failover\":%d}\n", failover ? 1 : 0);
    Serial.printf("# PATH %s\n", failover ? "FAILOVER: LoRa active" : "laser active");
    loraSend('H', failover ? "FO,0" : "up,0");
    forceStatus = true;
  }
}

// ----------------------------------------------------------------- status line (1 Hz, or right after a command)
static void emitStatus(uint32_t now) {
  uint32_t wc = workCnt;
  float bv = batVolts(); int bp = bv < 0 ? -1 : batPercent(bv);
  char b[512];
  snprintf(b, sizeof b,
    "{\"t\":\"status\",\"unit\":\"%c\",\"up\":%lu,\"laser\":%d,\"env\":%.4f,\"thr\":%.4f,\"mode\":%d,\"failover\":%d,"
    "\"tx\":%d,\"rx\":%d,\"vol\":%.2f,\"rxGain\":%.2f,\"micGain\":%.2f,\"duck\":%d,\"gate\":%d,"
    "\"micP2P\":%d,\"panP2P\":%d,\"workAvg\":%u,\"workMax\":%u,\"over\":%u,\"cal\":%d,"
    "\"lora\":{\"ok\":%d,\"peer\":\"%c\",\"peerLaser\":%d,\"ageS\":%ld,\"rssi\":%d,\"snr\":%.1f,\"tx\":%u,\"rx\":%u},\"batV\":%.2f,\"batPct\":%d}",
    UNIT_ID, (unsigned long)(now / 1000), laserLinkUp ? 1 : 0, (float)pilotEnvOut, (float)linkThresh, pathMode, failover ? 1 : 0,
    (int)txSrc, (int)rxSink, (float)vol, (float)rxGain, (float)micGain, duckOn ? 1 : 0, gateOn ? 1 : 0,
    (int)(micMax - micMin), (int)(panMax - panMin), wc ? (unsigned)(workSum / wc) : 0, (unsigned)workMax, (unsigned)overruns,
    calEndMs ? 1 : 0,
    loraOk ? 1 : 0, lastPeer, peerLaserUp ? 1 : 0, lastPeerMs ? (long)((now - lastPeerMs) / 1000) : -1L,
    lastRssi, lastSnr, (unsigned)txCount, (unsigned)rxCount, bv, bp);
  Serial.println(b);
  netPush(b);
}

// ----------------------------------------------------------------- input: keys, >text, and JSON commands
static char lineBuf[48]; static int lineLen = 0; static bool lineMode = false;
static char jsonBuf[160]; static int jsonLen = 0; static bool jsonMode = false;
static uint32_t pingSeq = 0;

static void help() {
  Serial.println(F("# TX src: 4 mic  3 tone  2 blink  1 steady  0 off | RX: p panel  k tone  x mute"));
  Serial.println(F("# +/- volume  ]/[ rx gain  G/g mic gain  d duck  n gate"));
  Serial.println(F("# l path mode  c calibrate  b LoRa ping  >text send LoRa message"));
  Serial.println(F("# JSON: {\"cmd\":\"set\",\"k\":\"vol\",\"v\":0.3} | {\"cmd\":\"mode\",\"v\":0} | {\"cmd\":\"cal\"} | {\"cmd\":\"ping\"} | {\"cmd\":\"msg\",\"text\":\"hi\"}"));
}

static void startCal() { calEndMs = millis() + 3000; calSum = 0; calCount = 0;
  Serial.println(F("# CAL measuring noise for 3 s: cover the panel, laser off at the far end")); }
static void sendPing() { char p[16]; snprintf(p, sizeof p, "%lu", (unsigned long)++pingSeq); loraSend('P', p); Serial.println(F("# LORA ping sent")); }

static void handleKey(char c) {
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
  else if (c == 'l') pathMode = (pathMode + 1) % 3;
  else if (c == 'c') startCal();
  else if (c == 'b') sendPing();
  else if (c == 'h') help();
  else return;
  forceStatus = true;
}

static void handleJson(const char *line) {
  JsonDocument d;
  if (deserializeJson(d, line)) { Serial.println(F("# bad json")); return; }
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "set")) {
    const char *k = d["k"] | ""; float v = d["v"] | 0.0f;
    if      (!strcmp(k, "txSrc"))   txSrc   = (int)clampf(v, 0, 4);
    else if (!strcmp(k, "rxSink"))  rxSink  = (int)clampf(v, 0, 2);
    else if (!strcmp(k, "vol"))     vol     = clampf(v, 0.05f, 1.0f);
    else if (!strcmp(k, "rxGain"))  rxGain  = clampf(v, 1.0f, 60.0f);
    else if (!strcmp(k, "micGain")) micGain = clampf(v, 0.5f, 30.0f);
    else if (!strcmp(k, "duck"))    duckOn  = v > 0;
    else if (!strcmp(k, "gate"))    gateOn  = v > 0;
    else return;
  }
  else if (!strcmp(cmd, "mode")) pathMode = constrain((int)(d["v"] | 0), 0, 2);
  else if (!strcmp(cmd, "cal"))  startCal();
  else if (!strcmp(cmd, "ping")) sendPing();
  else if (!strcmp(cmd, "msg"))  { const char *t = d["text"] | ""; if (*t) { loraSend('M', t); Serial.printf("# LORA sent: %s\n", t); } }
  else return;
  forceStatus = true;
}

static void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (jsonMode) {
      if (c == '\n' || c == '\r') { jsonBuf[jsonLen] = 0; if (jsonLen) handleJson(jsonBuf); jsonMode = false; jsonLen = 0; }
      else if (jsonLen < (int)sizeof(jsonBuf) - 1) jsonBuf[jsonLen++] = c;
      else { jsonMode = false; jsonLen = 0; Serial.println(F("# json line too long")); }
    } else if (lineMode) {
      if (c == '\n' || c == '\r') { lineBuf[lineLen] = 0; if (lineLen) { loraSend('M', lineBuf); Serial.printf("# LORA sent: %s\n", lineBuf); } lineMode = false; lineLen = 0; }
      else if (lineLen < (int)sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
    } else if (c == '{') { jsonMode = true; jsonLen = 0; jsonBuf[jsonLen++] = '{'; }
    else if (c == '>') { lineMode = true; lineLen = 0; }
    else if (c != '\n' && c != '\r') handleKey(c);
  }
}

// ----------------------------------------------------------------- setup / loop
void setup() {
  prefs.begin("beambi", false);
  linkThresh = prefs.getFloat("thr", 0.10f);
  Serial.begin(115200);
  delay(300);
  pinMode(PIN_LED, OUTPUT);
  adcInit();
  laserInit();
  laserWrite((uint32_t)(TX_BIAS * (float)MAXD));
  dacInit();
  rxHpf.highpass((float)FS_HZ, RX_HPF_HZ);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  loraOk = LoRa.begin(LORA_FREQ);
  if (loraOk) {
    LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
    LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_POWER);
    Serial.printf("# LoRa OK: %.1f MHz SF%d BW%.0fkHz unit %c\n", LORA_FREQ / 1e6, LORA_SF, LORA_BW / 1e3, UNIT_ID);
  } else {
    Serial.println(F("# LoRa FAILED to start: check 3.3 V, SPI wires, NSS/RST/DIO0 pins and the band. Laser audio still runs."));
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
  Serial.printf("{\"t\":\"hello\",\"unit\":\"%c\",\"fw\":\"%s\",\"loraOk\":%d}\n", UNIT_ID, FW_VERSION, loraOk ? 1 : 0);
  Serial.println(F("# BeamBi unit ready. Send h for commands."));

  netQ = xQueueCreate(8, sizeof(NetMsg));
  cmdQ = xQueueCreate(6, sizeof(CmdMsg));
  xTaskCreatePinnedToCore(netTask, "net", 10240, nullptr, 1, nullptr, 1);
}

void loop() {
  static uint32_t last = 0;
  uint32_t now = millis();
  serialPoll();
  { CmdMsg c; while (cmdQ && xQueueReceive(cmdQ, &c, 0) == pdTRUE) handleJson(c.s); }
  loraPoll();
  updatePath(now);

  if (loraOk && now - lastHbMs >= (failover ? HB_FAILOVER_MS : HB_MS)) {
    lastHbMs = now;
    char p[24]; snprintf(p, sizeof p, "%s,%u", failover ? "FO" : (laserLinkUp ? "up" : "down"), (unsigned)(rxEnvOut * 1000));
    loraSend('H', p);
  }
  digitalWrite(PIN_LED, laserLinkUp ? HIGH : LOW);

  bool sec = (now - last >= 1000);
  if (sec || forceStatus) {
    if (sec) last = now;
    forceStatus = false;
    emitStatus(now);
    if (sec) {
      uint32_t wc = workCnt;
      if (wc) Serial.printf("# TIMING us per sample: adc=%u dac=%u total=%u (budget 125) samples=%u\n",
                            (unsigned)(tAdcSum / wc), (unsigned)(tDacSum / wc), (unsigned)(workSum / wc), (unsigned)wc);
      micMin = 4095; micMax = 0; panMin = 4095; panMax = 0; panSum = 0; panCnt = 0;
      rxPeak = 0; workSum = 0; workCnt = 0; workMax = 0; tAdcSum = 0; tDacSum = 0;
    }
  }
  delay(5);
}