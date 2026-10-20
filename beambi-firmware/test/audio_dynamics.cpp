#include "audio_dynamics.h"
#include <cassert>
#include <iostream>

int main() {
  SpeechLinkDetector link;
  assert(!link.update(0.063f, 0.05f, 0));
  assert(!link.update(0.063f, 0.05f, 99));
  assert(link.update(0.063f, 0.05f, 100)); // Speech need not last 500 ms.
  assert(link.update(0.04f, 0.05f, 200)); // Hysteresis: above 70% release level.
  assert(link.update(0.008f, 0.05f, 300));
  assert(link.update(0.008f, 0.05f, 3299));
  assert(!link.update(0.008f, 0.05f, 3300));
  link.reset();
  for (uint32_t t = 0; t < 10000; t += 10)
    assert(!link.update(0.008f, 0.05f, t)); // Idle noise does not acquire a lock.
  link.reset();
  assert(!link.update(0.1f, 0.05f, UINT32_MAX - 50));
  assert(link.update(0.1f, 0.05f, 50)); // millis() rollover.

  ReceiverNoiseGate gate;
  float output = 0;
  for (int i = 0; i < 16000; ++i) output = gate.process(0.008f, 0.008f, 0.006f, true);
  assert(output > 0.0007f && output < 0.0009f); // About 20 dB idle attenuation.
  for (int i = 0; i < 1000; ++i) output = gate.process(0.1f, 0.05f, 0.006f, true);
  assert(output > 0.099f); // Speech passes after attack; no automatic gain boost.
  for (int i = 0; i < 16000; ++i) gate.process(0.008f, 0.008f, 0.006f, true);
  for (int i = 0; i < 1000; ++i) output = gate.process(0.008f, 0.008f, 0.006f, false);
  assert(output > 0.0079f); // Bypass restores the original receive signal.
  std::cout << "Speech lock, hysteresis, hold, timer rollover and soft noise gate passed\n";
}
