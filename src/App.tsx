import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { SnapshotProvider } from "./lib/SnapshotContext";
import { Home } from "./pages/Home";
import { Desk } from "./pages/Desk";
import { Compare } from "./pages/Compare";
import { Slip } from "./pages/Slip";
import { How } from "./pages/How";
import { Notes } from "./pages/Notes";

export default function App() {
  return (
    <SnapshotProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="desk" element={<Desk />} />
          <Route path="compare" element={<Navigate to="/compare/USD" replace />} />
          <Route path="compare/:code" element={<Compare />} />
          <Route path="slip" element={<Slip />} />
          <Route path="how" element={<How />} />
          <Route path="notes/:date" element={<Notes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SnapshotProvider>
  );
}
