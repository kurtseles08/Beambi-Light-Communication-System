import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Placeholder from './pages/Placeholder'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Placeholder title="Home" note="Active channel, link state, RSSI gauge, latency, bitrate, battery, alerts." />} />
        <Route path="disaster" element={<Placeholder title="Disaster Status" note="Real-time weather today and external disaster information." />} />
        <Route path="alignment" element={<Placeholder title="Alignment" note="Live RSSI, peak hold, trend, lock indicator." />} />
        <Route path="link" element={<Placeholder title="Link Details" note="FSO metrics, RF metrics, packet log." />} />
        <Route path="environment" element={<Placeholder title="Environment" note="Weather detection, attenuation trend, ambient light." />} />
        <Route path="security" element={<Placeholder title="Security" note="Tamper, encryption, jamming indicators." />} />
        <Route path="logs" element={<Placeholder title="Logs & Analytics" note="Event log, historical charts, export." />} />
        <Route path="settings" element={<Placeholder title="Settings" note="Thresholds, failover mode, calibration." />} />
      </Route>
    </Routes>
  )
}