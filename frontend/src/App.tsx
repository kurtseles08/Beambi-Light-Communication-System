import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
const Alignment = lazy(() => import("./pages/Alignment"));
const LinkDetails = lazy(() => import("./pages/LinkDetails"));
const Logs = lazy(() => import("./pages/Logs"));
const Settings = lazy(() => import("./pages/Settings"));
const HardwarePage = lazy(() => import("./device/HardwarePage"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="alignment" element={<Alignment />} />
        <Route path="link" element={<LinkDetails />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="hardware" element={<HardwarePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
