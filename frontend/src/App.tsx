import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Alignment from "./pages/Alignment";
import LinkDetails from "./pages/LinkDetails";
import Environment from "./pages/Environment";
import Security from "./pages/Security";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import DisasterStatus from "./pages/DisasterStatus";
import LiveDebug from "./pages/LiveDebug";
import HardwarePage from "./device/HardwarePage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="alignment" element={<Alignment />} />
        <Route path="link" element={<LinkDetails />} />
        <Route path="disaster" element={<DisasterStatus />} />
        <Route path="environment" element={<Environment />} />
        <Route path="security" element={<Security />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="debug" element={<LiveDebug />} />
        <Route path="hardware" element={<HardwarePage />} />
      </Route>
    </Routes>
  );
}
