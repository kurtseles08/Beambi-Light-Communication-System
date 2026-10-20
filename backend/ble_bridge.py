"""Battery gateway: BeamBi-A BLE UART -> local backend, with command replies."""
import asyncio
import json
import math
import os
import time
import urllib.request

SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'


def valid_report(report):
    if not isinstance(report, dict) or report.get('t') != 'status' or report.get('unit') not in ('A', 'B'):
        return False
    numeric = ('env', 'thr', 'up', 'mode', 'laser', 'failover', 'tx', 'rx', 'vol',
               'rxGain', 'micGain', 'duck', 'gate', 'micP2P', 'panP2P',
               'workAvg', 'workMax', 'over', 'cal')
    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if not all(number(report.get(key)) for key in numeric):
        return False
    radio = report.get('lora')
    return (isinstance(radio, dict) and isinstance(radio.get('peer'), str)
            and all(number(radio.get(key)) for key in
                    ('ok', 'peerLaser', 'ageS', 'rssi', 'snr', 'tx', 'rx')))


class ReportFramer:
    """Only complete, bounded JSON lines become reports. Never invent readings."""
    def __init__(self):
        self.pending = bytearray()
        self.overflow = False

    def feed(self, data):
        reports = []
        for byte in data:
            if byte == 10:
                if self.pending and not self.overflow:
                    try:
                        report = json.loads(self.pending)
                        if valid_report(report):
                            reports.append(report)
                    except (ValueError, UnicodeError):
                        pass
                self.pending.clear()
                self.overflow = False
            elif len(self.pending) < 4096:
                self.pending.append(byte)
            else:
                self.overflow = True
        return reports


def post_report(report):
    report = {**report, 'transport': 'lora+bluetooth' if report.get('via') == 'lora' else 'bluetooth'}
    url = 'http://127.0.0.1:' + os.environ.get('PORT', '4000') + '/api/device'
    request = urllib.request.Request(url, json.dumps(report).encode(),
        {'Content-Type': 'application/json', 'x-api-key': os.environ.get('DEVICE_KEY', '')})
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response).get('cmds', [])


async def run():
    from bleak import BleakClient, BleakScanner
    while True:
        try:
            print('[ble] scanning for BeamBi-A; power Unit A and enable laptop Bluetooth', flush=True)
            device = await BleakScanner.find_device_by_filter(
                lambda device, adv: adv.local_name == 'BeamBi-A' or device.name == 'BeamBi-A', timeout=10)
            if device is None:
                await asyncio.sleep(2)
                continue
            disconnected = asyncio.Event()
            async with BleakClient(device, disconnected_callback=lambda _: disconnected.set()) as client:
                print('[ble] connected to BeamBi-A (USB is not used)', flush=True)
                framer = ReportFramer()
                queues = {unit: asyncio.Queue(maxsize=1) for unit in ('A', 'B')}
                write_lock = asyncio.Lock()
                first = set()

                def receive(_, data):
                    for report in framer.feed(data):
                        queue = queues[report['unit']]
                        if queue.full():
                            queue.get_nowait()
                        queue.put_nowait((time.monotonic(), report))

                async def forward(unit):
                    while True:
                        received, report = await queues[unit].get()
                        if time.monotonic() - received > 2:
                            continue
                        try:
                            commands = await asyncio.to_thread(post_report, report)
                            if unit not in first:
                                first.add(unit)
                                print(f'[ble] Unit {unit} live reports accepted by dashboard', flush=True)
                            for command in commands:
                                payload = (json.dumps({**command, 'target': unit}, separators=(',', ':')) + '\n').encode()
                                if len(payload) > 255:
                                    continue
                                async with write_lock:
                                    # Leading newline clears an interrupted previous command.
                                    await client.write_gatt_char(RX, b'\n', response=True)
                                    for start in range(0, len(payload), 20):
                                        await client.write_gatt_char(RX, payload[start:start + 20], response=True)
                        except Exception as error:
                            # No replay: a failed/stale sample must not make a unit look online.
                            print(f'[ble] Unit {unit} forwarding failed: {error}', flush=True)

                await client.start_notify(TX, receive)
                tasks = [asyncio.create_task(forward(unit)) for unit in ('A', 'B')]
                try:
                    await disconnected.wait()
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as error:
            print(f'[ble] connection unavailable: {error}', flush=True)
        print('[ble] disconnected; units expire after 5 seconds without reports', flush=True)
        await asyncio.sleep(2)


if __name__ == '__main__':
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
