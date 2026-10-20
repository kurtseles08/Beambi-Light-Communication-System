import json
import unittest
from ble_bridge import ReportFramer, valid_report


def report(unit='A'):
    status = dict.fromkeys(('env', 'thr', 'up', 'mode', 'laser', 'failover', 'tx',
        'rx', 'vol', 'rxGain', 'micGain', 'duck', 'gate', 'micP2P', 'panP2P',
        'workAvg', 'workMax', 'over', 'cal'), 0)
    status.update(t='status', unit=unit, env=0.125, thr=0.1)
    status['lora'] = dict.fromkeys(('ok', 'peerLaser', 'ageS', 'rssi', 'snr', 'tx', 'rx'), 0)
    status['lora']['peer'] = '-'
    return status


class FramingTests(unittest.TestCase):
    def test_notifications_split_at_every_byte_boundary(self):
        data = (json.dumps(report()) + '\n').encode()
        for split in range(len(data)):
            framer = ReportFramer()
            self.assertEqual(framer.feed(data[:split]), [])
            self.assertEqual(framer.feed(data[split:]), [report()])

    def test_both_units_and_partial_packet_recovery(self):
        framer = ReportFramer()
        payload = (json.dumps(report()) + '\n' + json.dumps(report('B')) + '\n').encode()
        self.assertEqual(framer.feed(payload), [report(), report('B')])
        self.assertEqual(framer.feed(b'{"interrupted":\n' + payload), [report(), report('B')])

    def test_oversized_and_invalid_packets_do_not_become_live_data(self):
        framer = ReportFramer()
        self.assertEqual(framer.feed(b'x' * 5000 + b'\n'), [])
        self.assertEqual(framer.feed(b'null\n{}\n{"t":"status","unit":"B"}\n'), [])
        self.assertEqual(framer.feed((json.dumps(report()) + '\n').encode()), [report()])
        invalid = report()
        invalid['env'] = float('nan')
        self.assertFalse(valid_report(invalid))
        invalid = report()
        invalid['lora'] = None
        self.assertFalse(valid_report(invalid))


if __name__ == '__main__':
    unittest.main()
