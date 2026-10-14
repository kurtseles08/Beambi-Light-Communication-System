import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Screen from './components/Screen'
import Home from './pages/Home'
import Alignment from './pages/Alignment'
import LinkDetails from './pages/LinkDetails'
import DisasterStatus from './pages/DisasterStatus'
import LiveDebug from './pages/LiveDebug'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="alignment" element={<Alignment />} />
        <Route path="link" element={<LinkDetails />} />
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
