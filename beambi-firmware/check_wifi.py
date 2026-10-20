"""Read Wi-Fi diagnostics without sending commands or forwarding USB telemetry."""
import json
import sys
import time
import serial

port = serial.Serial(port=None, baudrate=115200, timeout=1)
port.dtr = False
port.rts = False
port.port = sys.argv[1] if len(sys.argv) > 1 else "COM9"
port.open()
try:
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        line = port.readline().decode("utf-8", errors="replace").strip()
        if not line.startswith("{"):
            continue
        try:
            status = json.loads(line)
        except ValueError:
            continue
        if status.get("t") == "status":
            print(json.dumps({key: status.get(key) for key in
                ("unit", "up", "wifi", "httpCode", "adcErrors", "over")}), flush=True)
finally:
    port.close()
