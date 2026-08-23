import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AlertsPage } from "./pages/AlertsPage";
import { AppShell } from "./pages/AppShell";
import { BookingsPage } from "./pages/BookingsPage";
import { RequestResponsePage } from "./pages/RequestResponsePage";
import { DriversPage } from "./pages/DriversPage";
import { GeofencesPage } from "./pages/GeofencesPage";
import { GroupsPage } from "./pages/GroupsPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { RadioInboxPage } from "./pages/RadioInboxPage";
import { ReplayPage } from "./pages/ReplayPage";
import { ManifestsPage } from "./pages/ManifestsPage";
import { FamilyCirclesPage } from "./pages/FamilyCirclesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { routeFeature } from "./solutionProfiles";
import { SosProvider } from "./SosProvider";
import { SolutionProfileProvider, useSolutionProfile } from "./useSolutionProfile";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, isDispatcher } = useAuth();
  if (loading) return <div className="auth-shell">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isDispatcher) return <Navigate to="/login" replace />;
  return children;
}

function FeatureRoute({
  feature,
  children,
}: {
  feature: ReturnType<typeof routeFeature>;
  children: React.ReactNode;
}) {
  const { isEnabled, loading } = useSolutionProfile();
  const location = useLocation();

  if (loading) return <div className="auth-shell">Loading…</div>;

  const routeFeatureKey =
    feature ?? routeFeature(location.pathname.replace(/\/$/, "") || "/map");
  if (routeFeatureKey && !isEnabled(routeFeatureKey)) {
    return <Navigate to="/map" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
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
        <Route
          path="map"
          element={
            <FeatureRoute feature="map">
              <MapPage />
            </FeatureRoute>
          }
        />
        <Route
          path="inbox"
          element={
            <FeatureRoute feature="inbox">
              <RadioInboxPage />
            </FeatureRoute>
          }
        />
        <Route
          path="replay"
          element={
            <FeatureRoute feature="replay">
              <ReplayPage />
            </FeatureRoute>
          }
        />
        <Route
          path="geofences"
          element={
            <FeatureRoute feature="geofences">
              <GeofencesPage />
            </FeatureRoute>
          }
        />
        <Route
          path="groups"
          element={
            <FeatureRoute feature="groups">
              <GroupsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="alerts"
          element={
            <FeatureRoute feature="alerts">
              <AlertsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="drivers"
          element={
            <FeatureRoute feature="drivers">
              <DriversPage />
            </FeatureRoute>
          }
        />
        <Route
          path="requests"
          element={
            <FeatureRoute feature="requestResponse">
              <RequestResponsePage />
            </FeatureRoute>
          }
        />
        <Route
          path="bookings"
          element={
            <FeatureRoute feature="bookings">
              <BookingsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="vehicles"
          element={
            <FeatureRoute feature="vehicles">
              <VehiclesPage />
            </FeatureRoute>
          }
        />
        <Route
          path="manifests"
          element={
            <FeatureRoute feature="manifests">
              <ManifestsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="family"
          element={
            <FeatureRoute feature="family">
              <FamilyCirclesPage />
            </FeatureRoute>
          }
        />
        <Route
          path="reports"
          element={
            <FeatureRoute feature="reports">
              <ReportsPage />
            </FeatureRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SolutionProfileProvider>
        <SosProvider>
          <AppRoutes />
        </SosProvider>
      </SolutionProfileProvider>
    </AuthProvider>
  );
}

