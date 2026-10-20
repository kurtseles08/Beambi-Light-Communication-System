"""Compare raw board status to BLE-delivered dashboard data; backend USB must be off."""
import json
import sys
import time
import urllib.request
import serial

unit = sys.argv[2] if len(sys.argv) > 2 else 'A'
if unit not in ('A', 'B'):
    raise ValueError('Unit must be A or B')
transport = 'bluetooth' if unit == 'A' else 'lora+bluetooth'
port = serial.Serial(port=None, baudrate=115200, timeout=1)
port.dtr = False
port.rts = False
port.port = sys.argv[1] if len(sys.argv) > 1 else 'COM9'
port.open()
matched = 0
try:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline and matched < 3:
        try:
            raw = json.loads(port.readline())
        except (ValueError, UnicodeError):
            continue
        if raw.get('t') != 'status' or raw.get('unit') != unit:
            continue
        for _ in range(30 if unit == 'B' else 12):
            with urllib.request.urlopen('http://127.0.0.1:4000/api/device?unit=' + unit, timeout=2) as response:
                delivered = json.load(response)
            if delivered and delivered.get('up') == raw['up']:
                assert delivered.get('transport') == transport, delivered.get('transport')
                assert all(delivered.get(key) == value for key, value in raw.items()), 'Status mismatch'
                assert delivered.get('wifi') == 0, 'Wi-Fi must be off'
                assert delivered.get('adcErrors') == 0, 'ADC2 reads failed'
                matched += 1
                print(f"MATCH {matched}: unit={unit}, transport={transport}, uptime={raw['up']}, mic={raw.get('micMin')}..{raw.get('micMax')}, ADC errors=0", flush=True)
                break
            if delivered and delivered.get('up', -1) > raw['up']:
                break # Drain buffered USB lines; B sends only every second status over LoRa.
            time.sleep(0.1)
    if matched < 3:
        raise RuntimeError('Could not match three BLE reports to raw board data')
finally:
    port.close()
