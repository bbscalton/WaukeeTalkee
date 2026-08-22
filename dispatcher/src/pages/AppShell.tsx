import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { FleetAlertsProvider, useFleetAlerts } from "../FleetAlertsProvider";
import { ORG_ID } from "../firebase";
import { RadioLiveProvider } from "../RadioLiveProvider";
import { useRadioArchive } from "../useRadioArchive";

function ShellNav() {
  const { user, logout } = useAuth();
  const { totalUnread } = useRadioArchive();
  const { unread } = useFleetAlerts();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <strong>Waukee Talkee</strong>
          <span className="muted">Dispatch · {ORG_ID}</span>
        </div>
        <nav>
          <NavLink to="/map">Radio map</NavLink>
          <NavLink to="/inbox">
            Inbox
            {totalUnread > 0 && (
              <span className="nav-badge">{totalUnread}</span>
            )}
          </NavLink>
          <NavLink to="/replay">Map DVR</NavLink>
          <NavLink to="/geofences">Bases</NavLink>
          <NavLink to="/alerts">
            Alerts
            {unread > 0 && <span className="nav-badge">{unread}</span>}
          </NavLink>
          <NavLink to="/drivers">Drivers</NavLink>
          <NavLink to="/contacts">Contacts</NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
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
