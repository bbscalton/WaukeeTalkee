import { useState } from "react";
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

/** Map route keys to emoji icons for the nav */
const NAV_ICONS: Record<string, string> = {
  map:             "🗺️",
  inbox:           "📻",
  replay:          "📹",
  geofences:       "📍",
  alerts:          "🔔",
  drivers:         "🚗",
  groups:          "👥",
  requestResponse: "📞",
  bookings:        "📋",
  vehicles:        "🚙",
  manifests:       "📄",
  family:          "👨‍👩‍👧",
  reports:         "📊",
  policeHazards:   "👮",
};

/** Human-readable label overrides */
const NAV_LABELS: Record<string, string> = {
  vehicles:        "Vehicles",
  manifests:       "Manifests",
  family:          "Family Circle",
  reports:         "Reports",
  policeHazards:   "Police & Radar",
};

function ShellNav() {
  const { user, logout, dispatcherRole } = useAuth();
  const { totalUnread } = useRadioArchive();
  const { unread } = useFleetAlerts();
  const { profile, isEnabled, label } = useSolutionProfile();
  const { activeSosEvents, resolveSos } = useSos();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleRoutes = NAV_ROUTES.filter((route) => isEnabled(route.feature));

  function routeLabel(route: (typeof NAV_ROUTES)[number]) {
    return NAV_LABELS[route.key] ?? NAV_LABELS[route.feature] ?? label(route.labelKey);
  }

  const userInitial = (user?.email ?? "D")[0].toUpperCase();
  const userEmail   = user?.email ?? "";

  return (
    <div className="shell">

      {/* ── SOS emergency banner ─────────────────────────────────────── */}
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

      {/* ── Top command bar ──────────────────────────────────────────── */}
      <header className="topbar">

        {/* Brand */}
        <div className="topbar-brand">
          <span className="topbar-logo">📡</span>
          <div className="topbar-brand-text">
            <strong className="topbar-name">{profile.displayName}</strong>
            <span className="topbar-sub">
              <span className="topbar-live-dot" />
              Dispatch · <span className="topbar-org">{ORG_ID}</span>
            </span>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="topbar-nav">
          {visibleRoutes.map((route) => {
            const icon  = NAV_ICONS[route.key] ?? NAV_ICONS[route.feature] ?? "•";
            const lbl   = routeLabel(route);
            const badge =
              route.key === "inbox"  && totalUnread > 0   ? totalUnread :
              route.key === "alerts" && unread > 0        ? unread      : 0;
            const sosBadge = route.key === "alerts" && activeSosEvents.length > 0;

            return (
              <NavLink
                key={route.key}
                to={route.path}
                className={({ isActive }) =>
                  "topbar-link" + (isActive ? " topbar-link--active" : "")
                }
              >
                <span className="topbar-link-icon">{icon}</span>
                <span className="topbar-link-label">{lbl}</span>
                {sosBadge && (
                  <span className="nav-badge danger-badge">{activeSosEvents.length} SOS</span>
                )}
                {!sosBadge && badge > 0 && (
                  <span className="nav-badge">{badge}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User cluster */}
        <div className="topbar-user">
          <span className="topbar-role-pill">{formatDispatcherRole(dispatcherRole)}</span>
          <div className="topbar-avatar" title={userEmail}>{userInitial}</div>
          <span className="topbar-email">{userEmail}</span>
          <button
            type="button"
            className="topbar-signout"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="topbar-hamburger"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </header>

      {/* ── Mobile drawer ────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="topbar-drawer" onClick={() => setMobileOpen(false)}>
          {visibleRoutes.map((route) => {
            const icon = NAV_ICONS[route.key] ?? NAV_ICONS[route.feature] ?? "•";
            const lbl  = routeLabel(route);
            return (
              <NavLink
                key={route.key}
                to={route.path}
                className={({ isActive }) =>
                  "drawer-link" + (isActive ? " drawer-link--active" : "")
                }
              >
                <span>{icon}</span> {lbl}
              </NavLink>
            );
          })}
          <div className="drawer-user">
            <span className="topbar-role-pill">{formatDispatcherRole(dispatcherRole)}</span>
            <span className="muted">{userEmail}</span>
            <button type="button" className="ghost" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────────────── */}
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
