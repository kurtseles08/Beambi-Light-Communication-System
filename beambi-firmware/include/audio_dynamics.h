#pragma once
#include <stdint.h>
#include <math.h>

// Envelope-based speech indication, not proof of optical alignment. Hysteresis
// and a release hold prevent ordinary gaps between words from flapping the link.
class SpeechLinkDetector {
  bool up = false, rising = false, falling = false;
  uint32_t riseAt = 0, fallAt = 0;
public:
  bool update(float envelope, float threshold, uint32_t now) {
    if (!up) {
      falling = false;
      if (envelope >= threshold) {
        if (!rising) { rising = true; riseAt = now; }
        if ((uint32_t)(now - riseAt) >= 100) { up = true; rising = false; }
      } else rising = false;
    } else {
      rising = false;
      if (envelope < threshold * 0.7f) {
        if (!falling) { falling = true; fallAt = now; }
        if ((uint32_t)(now - fallAt) >= 3000) { up = false; falling = false; }
      } else falling = false;
    }
    return up;
  }
  void reset() { up = rising = falling = false; }
};

// Gentle downward gate. Attenuates the noise between phrases; cannot separate
// an in-band buzz from speech. Attack ~20 ms, release ~250 ms at 5 kHz.
class ReceiverNoiseGate {
  float gain = 1.0f;
  bool open = false;
public:
  float process(float sample, float envelope, float noiseFloor, bool enabled) {
    float floor = fmaxf(noiseFloor, 0.0005f);
    if (envelope > floor * 3.0f) open = true;
    else if (envelope < floor * 1.5f) open = false;
    float target = (!enabled || open) ? 1.0f : 0.1f;
    gain += (target > gain ? 0.01f : 0.0008f) * (target - gain);
    return sample * gain;
  }
};
