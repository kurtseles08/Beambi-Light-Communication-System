#include "lora_telemetry.h"
#include <cassert>
#include <cstdint>
#include <iostream>

int main() {
  JsonDocument original;
  // Exercise maximum counters and noninteger ADC/DSP readings, not only boot zeros.
  for (const char *key : STATUS_KEYS) original[key] = UINT32_MAX;
  for (const char *key : {"env", "thr", "vol", "rxGain", "micGain", "savedMicGain"})
    original[key] = 0.1234567f;
  original["batV"] = -1;
  original["batPct"] = -1;
  for (const char *key : RADIO_KEYS) original["lora"][key] = UINT32_MAX;
  original["lora"]["peer"] = "A";
  original["lora"]["rssi"] = -117;
  original["lora"]["snr"] = -7.25f;
  original["lora"]["ageS"] = -1;
  uint8_t payload[248];
  size_t length = encodeTelemetry(original, payload, sizeof(payload));
  assert(length > 0 && length <= 248);
  JsonDocument decoded;
  assert(decodeTelemetry(payload, length, 'B', decoded));
  assert(decoded["unit"] == "B" && decoded["via"] == "lora");
  for (const char *key : STATUS_KEYS) assert(decoded[key] == original[key]);
  for (const char *key : RADIO_KEYS) assert(decoded["lora"][key] == original["lora"][key]);
  assert(encodeTelemetry(original, payload, 8) == 0);
  assert(!decodeTelemetry(payload, length - 1, 'B', decoded));
  const uint8_t badVersion[] = {0x91, 0x03};
  assert(!decodeTelemetry(badVersion, sizeof(badVersion), 'B', decoded));
  std::cout << "Telemetry round trip, max counters, packet limit and malformed packets passed ("
            << length + 7 << "/255 bytes including header)\n";
}
