import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { FleetAlertsProvider, useFleetAlerts } from "../FleetAlertsProvider";
import { ORG_ID } from "../firebase";
import { RadioLiveProvider } from "../RadioLiveProvider";
import { NAV_ROUTES } from "../solutionProfiles";
import { useRadioArchive } from "../useRadioArchive";
import { useSolutionProfile } from "../useSolutionProfile";

function ShellNav() {
  const { user, logout } = useAuth();
  const { totalUnread } = useRadioArchive();
  const { unread } = useFleetAlerts();
  const { profile, isEnabled, label } = useSolutionProfile();

  const visibleRoutes = NAV_ROUTES.filter((route) => isEnabled(route.feature));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <strong>{profile.displayName}</strong>
          <span className="muted">Dispatch · {ORG_ID}</span>
        </div>
        <nav>
          {visibleRoutes.map((route) => (
            <NavLink key={route.key} to={route.path}>
              {label(route.labelKey)}
              {route.key === "inbox" && totalUnread > 0 && (
                <span className="nav-badge">{totalUnread}</span>
              )}
              {route.key === "alerts" && unread > 0 && (
                <span className="nav-badge">{unread}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-user">
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
