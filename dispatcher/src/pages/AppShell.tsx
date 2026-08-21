import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { ORG_ID } from "../firebase";

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <strong>Waukee Talkee</strong>
          <span className="muted">Dispatch · {ORG_ID}</span>
        </div>
        <nav>
          <NavLink to="/map">Radio map</NavLink>
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
