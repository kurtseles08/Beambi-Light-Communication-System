#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID  = "jps";
const char* WIFI_PASS  = "johnpaul25";
const char* SERVER_URL = "http://192.168.1.50:4000/api/telemetry"; // PC's LAN IP, not localhost
const char* DEVICE_KEY = "pick-a-long-random-string";
const char* UNIT_ID    = "A";   // flash "B" on the second unit

const int RX_PIN     = 34;      // ADC1 pin, so it works while Wi-Fi is on
const int ADC_DARK   = 100;     // calibrate: reading with no light
const int ADC_BRIGHT = 3500;    // calibrate: reading with the laser aligned

float readRssi() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(RX_PIN);
  int raw = sum / 16;
  return constrain(map(raw, ADC_DARK, ADC_BRIGHT, 0, 100), 0, 100);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nIP: " + WiFi.localIP().toString());
}

void setup() {
  Serial.begin(115200);
  connectWifi();
}

void loop() {
  static unsigned long lastSend = 0;
  if (millis() - lastSend < 1000) return;
  lastSend = millis();

  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); return; }

  JsonDocument doc;
  doc["unit"] = UNIT_ID;
  doc["rssi"] = readRssi();
  doc["channel"] = "FSO";   // set to "RF" when your firmware switches to LoRa
  doc["laserOk"] = true;
  // Add as you wire real sensors: battery, voltage, tempC, humidityPct, lux,
  // rfRssi, rfSnr, txFrames, rxFrames, rxLost, lossPct, latencyMs, encrypted, cipher

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setTimeout(2000);
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_KEY);
  int code = http.POST(body);
  Serial.printf("POST -> %d\n", code);
  http.end();
}