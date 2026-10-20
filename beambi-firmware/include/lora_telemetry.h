#pragma once
#include <ArduinoJson.h>

// Versioned, positional MessagePack keeps a full status inside one SX127x packet.
// Seven bytes are reserved for BB:<unit>:T:, leaving 248 payload bytes.
static const char *const STATUS_KEYS[] = {
  "up", "fs", "laser", "env", "thr", "mode", "failover", "tx", "rx",
  "vol", "rxGain", "micGain", "savedMicGain", "duck", "gate", "micP2P",
  "panP2P", "micMin", "micMax", "panMin", "panMax", "adcErrors",
  "micSamples", "micRailSamples", "txClipSamples", "workAvg", "workMax",
  "over", "cal", "batV", "batPct", "audioV", "rxGate", "rxNoiseFloor"
};
static const char *const RADIO_KEYS[] = {
  "ok", "enabled", "peer", "peerLaser", "ageS", "rssi", "snr", "tx", "rx"
};
static constexpr size_t STATUS_COUNT = sizeof(STATUS_KEYS) / sizeof(STATUS_KEYS[0]);
static constexpr size_t RADIO_COUNT = sizeof(RADIO_KEYS) / sizeof(RADIO_KEYS[0]);

static size_t encodeTelemetry(JsonDocument &status, uint8_t *out, size_t capacity) {
  JsonDocument packed;
  JsonArray values = packed.to<JsonArray>();
  values.add(2); // Version 2 adds receiver noise controls.
  for (const char *key : STATUS_KEYS) values.add(status[key]);
  for (const char *key : RADIO_KEYS) values.add(status["lora"][key]);
  if (measureMsgPack(packed) > capacity) return 0;
  return serializeMsgPack(packed, out, capacity);
}

static bool decodeTelemetry(const uint8_t *data, size_t length, char from, JsonDocument &status) {
  JsonDocument packed;
  if (deserializeMsgPack(packed, data, length)) return false;
  JsonArrayConst values = packed.as<JsonArrayConst>();
  if (values.size() != 1 + STATUS_COUNT + RADIO_COUNT || values[0] != 2) return false;
  for (size_t i = 0; i < STATUS_COUNT; ++i)
    if (!values[i + 1].is<float>()) return false;
  if (!values[1 + STATUS_COUNT + 2].is<const char *>()) return false;
  status.clear();
  char unit[2] = {from, 0};
  status["t"] = "status"; status["unit"] = unit;
  status["via"] = "lora"; status["gateway"] = "A"; status["wifi"] = 0;
  size_t index = 1;
  for (const char *key : STATUS_KEYS) status[key] = values[index++];
  for (const char *key : RADIO_KEYS) status["lora"][key] = values[index++];
  return true;
}
