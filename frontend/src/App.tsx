import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Screen from './components/Screen'
import DisasterStatus from './pages/DisasterStatus'
import LiveDebug from './pages/LiveDebug'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Screen id="home" />} />
        <Route path="alignment" element={<Screen id="alignment" />} />
        <Route path="link" element={<Screen id="link" />} />
        <Route path="disaster" element={<DisasterStatus />} />
        <Route path="environment" element={<Screen id="environment" />} />
        <Route path="security" element={<Screen id="security" />} />
        <Route path="logs" element={<Screen id="logs" />} />
        <Route path="settings" element={<Screen id="settings" />} />
        <Route path="debug" element={<LiveDebug />} />
      </Route>
    </Routes>
  )
}