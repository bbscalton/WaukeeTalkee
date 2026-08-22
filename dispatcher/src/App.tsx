import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AlertsPage } from "./pages/AlertsPage";
import { AppShell } from "./pages/AppShell";
import { BookingsPage } from "./pages/BookingsPage";
import { ContactsPage } from "./pages/ContactsPage";
import { DriversPage } from "./pages/DriversPage";
import { GeofencesPage } from "./pages/GeofencesPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { RadioInboxPage } from "./pages/RadioInboxPage";
import { ReplayPage } from "./pages/ReplayPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, isDispatcher } = useAuth();
  if (loading) return <div className="auth-shell">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isDispatcher) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="map" element={<MapPage />} />
          <Route path="inbox" element={<RadioInboxPage />} />
          <Route path="replay" element={<ReplayPage />} />
          <Route path="geofences" element={<GeofencesPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="drivers" element={<DriversPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="bookings" element={<BookingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
