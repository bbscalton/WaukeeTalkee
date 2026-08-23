import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { FleetAlertsProvider, useFleetAlerts } from "../FleetAlertsProvider";
import { ORG_ID } from "../firebase";
import { RadioLiveProvider } from "../RadioLiveProvider";
import { NAV_ROUTES } from "../solutionProfiles";
import { useRadioArchive } from "../useRadioArchive";
import { useSolutionProfile } from "../useSolutionProfile";
import { useSos } from "../SosProvider";
import { formatDispatcherRole } from "../types";

function ShellNav() {
  const { user, logout, dispatcherRole } = useAuth();
  const { totalUnread } = useRadioArchive();
  const { unread } = useFleetAlerts();
  const { profile, isEnabled, label } = useSolutionProfile();
  const { activeSosEvents, resolveSos } = useSos();

  const visibleRoutes = NAV_ROUTES.filter((route) => isEnabled(route.feature));

  return (
    <div className="shell">
      {activeSosEvents.length > 0 && (
        <div className="sos-banner">
          <div className="sos-banner-content">
            <span className="sos-pulse">🚨 EMERGENCY SOS</span>
            {activeSosEvents.map((evt) => (
              <span key={evt.id} className="sos-event-item">
                <strong>{evt.driverName}</strong> requested help! ({evt.message})
                <button
                  type="button"
                  className="sos-resolve-btn"
                  onClick={() => void resolveSos(evt.id)}
                >
                  Resolve Alert
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-brand">
          <strong>{profile.displayName}</strong>
          <span className="muted">Dispatch · {ORG_ID}</span>
        </div>
        <nav>
          {visibleRoutes.map((route) => (
            <NavLink key={route.key} to={route.path}>
              {route.key === "vehicles"
                ? "Vehicles"
                : route.key === "manifests"
                ? "Manifests"
                : route.key === "family"
                ? "Family Circle"
                : route.key === "reports"
                ? "Reports"
                : label(route.labelKey)}
              {route.key === "inbox" && totalUnread > 0 && (
                <span className="nav-badge">{totalUnread}</span>
              )}
              {route.key === "alerts" && unread > 0 && (
                <span className="nav-badge">{unread}</span>
              )}
              {route.key === "alerts" && activeSosEvents.length > 0 && (
                <span className="nav-badge danger-badge">{activeSosEvents.length} SOS</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-user">
          <span className="pill role-pill">{formatDispatcherRole(dispatcherRole)}</span>
          <span className="muted">{user?.email}</span>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function AppShell() {
  return (
    <RadioLiveProvider>
      <FleetAlertsProvider>
        <ShellNav />
      </FleetAlertsProvider>
    </RadioLiveProvider>
  );
}

