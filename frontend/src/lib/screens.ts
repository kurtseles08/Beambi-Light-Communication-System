export type Kind = 'kpi' | 'gauge' | 'chart' | 'table' | 'form'

export type Block = {
  title: string
  hint: string
  kind: Kind
  span: 3 | 4 | 6 | 8 | 12 // out of 12 columns
  height?: 'sm' | 'md' | 'lg'
}

export type ScreenSpec = { title: string; subtitle: string; blocks: Block[] }

export const screens = {
  home: {
    title: 'Home',
    subtitle: 'Is the link working right now?',
    blocks: [
      { title: 'Active channel', hint: 'FSO or RF, large and color-coded', kind: 'kpi', span: 4 },
      { title: 'Link state', hint: 'Searching, Aligning, Locked, Degraded, Failover, Re-acquiring', kind: 'kpi', span: 4 },
      { title: 'Overall status', hint: 'Normal, Degraded, Emergency (RF fallback) or Offline', kind: 'kpi', span: 4 },
      { title: 'FSO signal strength', hint: 'RSSI gauge with failover and lock marks', kind: 'gauge', span: 4 },
      { title: 'Unit A → Unit B', hint: 'Connection, bitrate, latency, jitter, packet loss', kind: 'table', span: 4 },
      { title: 'Unit B → Unit A', hint: 'Connection, bitrate, latency, jitter, packet loss', kind: 'table', span: 4 },
      { title: 'Unit A battery', hint: 'Level, voltage, online status', kind: 'kpi', span: 3 },
      { title: 'Unit B battery', hint: 'Level, voltage, online status', kind: 'kpi', span: 3 },
      { title: 'Session', hint: 'Uptime, failover count, last failover and reason', kind: 'kpi', span: 3 },
      { title: 'Active alerts', hint: 'Count and most severe alert', kind: 'kpi', span: 3 },
    ],
  },
  alignment: {
    title: 'Alignment',
    subtitle: 'For the person aiming the laser',
    blocks: [
      { title: 'Live RSSI', hint: 'Live bar with a peak-hold marker', kind: 'gauge', span: 4 },
      { title: 'Alignment status', hint: 'Aligned / Not aligned, drift warning', kind: 'kpi', span: 4 },
      { title: 'Lock threshold and beep', hint: 'Lock threshold, optional pitch-rising beep', kind: 'form', span: 4 },
      { title: 'RSSI trend (last 60 s)', hint: 'Trend line with a horizontal lock-threshold line', kind: 'chart', span: 12 },
    ],
  },
  link: {
    title: 'Link Details',
    subtitle: 'FSO and RF metrics, and the packet log',
    blocks: [
      { title: 'FSO metrics', hint: 'RSSI, SNR, BER before and after FEC, frame loss, laser and receiver status', kind: 'table', span: 4 },
      { title: 'RF (LoRa) metrics', hint: 'RSSI, SNR, hop channel, hop sync, retransmissions, codec, encryption', kind: 'table', span: 4 },
      { title: 'Transfer counters', hint: 'Frames sent, received, lost; bytes and live bitrate per direction', kind: 'table', span: 4 },
      { title: 'Packet log', hint: 'Timestamp, direction, channel, sequence, size, CRC/FEC result, status', kind: 'table', span: 12, height: 'lg' },
    ],
  },
  environment: {
    title: 'Environment',
    subtitle: 'Conditions inferred from the signal',
    blocks: [
      { title: 'Detected condition', hint: 'Clear, Fog, Rain, Dust or Obstruction', kind: 'kpi', span: 4 },
      { title: 'Link margin', hint: 'Signal headroom before failover', kind: 'kpi', span: 4 },
      { title: 'Ambient light', hint: 'Photodiode noise factor', kind: 'kpi', span: 4 },
      { title: 'Attenuation trend', hint: 'Gradual drop suggests fog or rain, sudden drop suggests obstruction', kind: 'chart', span: 8 },
      { title: 'Temperature and humidity', hint: 'Optional DHT22 sensor', kind: 'kpi', span: 4 },
    ],
  },
  security: {
    title: 'Security',
    subtitle: 'Encryption, tamper and jamming indicators',
    blocks: [
      { title: 'Encryption status', hint: 'Per channel (FSO and RF)', kind: 'kpi', span: 4 },
      { title: 'Failed decryptions', hint: 'Authentication and decryption failures', kind: 'kpi', span: 4 },
      { title: 'RF jamming', hint: 'Noise floor and loss across hop channels', kind: 'kpi', span: 4 },
      { title: 'Tamper alerts', hint: 'Timestamp and unit', kind: 'table', span: 6 },
      { title: 'Beam interruption events', hint: 'Obstruction events with duration', kind: 'table', span: 6 },
    ],
  },
  logs: {
    title: 'Logs & Analytics',
    subtitle: 'Event log, history, and export',
    blocks: [
      { title: 'Average RSSI', hint: 'Over the selected run', kind: 'kpi', span: 3 },
      { title: 'Max range tested', hint: 'Distance entered per test run', kind: 'kpi', span: 3 },
      { title: 'Packet delivery ratio', hint: 'Delivered / sent', kind: 'kpi', span: 3 },
      { title: 'Total uptime', hint: 'Link up time in the run', kind: 'kpi', span: 3 },
      { title: 'Historical charts', hint: 'RSSI, SNR, BER and latency over time', kind: 'chart', span: 8 },
      { title: 'Test runs and export', hint: 'Start and stop a run, CSV export', kind: 'form', span: 4 },
      { title: 'Event log', hint: 'Severity (Info, Warning, Critical), filter and search', kind: 'table', span: 12, height: 'lg' },
    ],
  },
  settings: {
    title: 'Settings',
    subtitle: 'Thresholds, failover mode, calibration, demo mode',
    blocks: [
      { title: 'Failover thresholds', hint: 'RSSI and packet-loss limits with hysteresis', kind: 'form', span: 6 },
      { title: 'Failover mode', hint: 'Auto, Force FSO or Force RF', kind: 'form', span: 6 },
      { title: 'Calibration', hint: 'RSSI scaling and ambient-light baseline', kind: 'form', span: 6 },
      { title: 'Test and demo mode', hint: 'Inject packet loss, simulate fog, block the beam', kind: 'form', span: 6 },
    ],
  },
} satisfies Record<string, ScreenSpec>