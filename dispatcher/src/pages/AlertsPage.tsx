import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { eventMessage, useFleetAlerts } from "../FleetAlertsProvider";
import { clearAllFleetEvents, deleteFleetEvent } from "../fleetEvents";
import {
  formatDwellMs,
  formatFleetEventType,
  type FleetEvent,
} from "../types";

function eventTime(ev: FleetEvent): string {
  const ts = ev.at;
  if (!ts) return "—";
  let ms = 0;
  if ("toMillis" in ts && typeof (ts as { toMillis: () => number }).toMillis === "function") {
    ms = (ts as { toMillis: () => number }).toMillis();
  } else if ("seconds" in ts) {
    ms = ts.seconds * 1000;
  }
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AlertsPage() {
  const { events, markSeen } = useFleetAlerts();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters & Selection
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    markSeen();
  }, [markSeen, events.length]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const matchesType =
        typeFilter === "all"
          ? true
          : typeFilter === "speed_alert"
          ? ev.type === "speed_alert"
          : typeFilter === "geofence"
          ? ev.type === "place_arrived" || ev.type === "place_dwell" || ev.type === "place_left"
          : typeFilter === "off_route"
          ? ev.type === "off_route"
          : true;

      const msg = eventMessage(ev).toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        ev.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.includes(searchQuery.toLowerCase());

      return matchesType && matchesSearch;
    });
  }, [events, typeFilter, searchQuery]);

  // Analytics Metrics
  const speedingCount = events.filter((e) => e.type === "speed_alert").length;
  const geofenceCount = events.filter((e) => e.type === "place_arrived" || e.type === "place_dwell" || e.type === "place_left").length;
  const offRouteCount = events.filter((e) => e.type === "off_route").length;

  // Selection Handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEvents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map((e) => e.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeEvent = async (ev: FleetEvent) => {
    if (
      !window.confirm(
        `Delete this ${formatFleetEventType(ev.type).toLowerCase()} alert for ${ev.driverName}?`
      )
    ) {
      return;
    }
    setBusyId(ev.id);
    try {
      await deleteFleetEvent(ev.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(ev.id);
        return next;
      });
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not delete alert."
      );
    } finally {
      setBusyId(null);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected fleet alert(s)?`)) return;
    setBusyId("batch");
    try {
      for (const id of Array.from(selectedIds)) {
        await deleteFleetEvent(id);
      }
      setSelectedIds(new Set());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete selected alerts.");
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    if (events.length === 0) return;
    if (
      !window.confirm(
        `Delete ALL ${events.length} fleet alerts for this organization?`
      )
    ) {
      return;
    }
    setBusyId("all");
    try {
      await clearAllFleetEvents();
      setSelectedIds(new Set());
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not clear alerts."
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="manga-page">
      <div className="manga-hero">
        <div>
          <div className="manga-hero-meta">
            <span className="manga-chip manga-chip--danger">Fleet Telemetry Monitor</span>
            <span className="manga-hero-note">Automatic 7-Day Retention Rolling Archive</span>
          </div>
          <h1 className="manga-title">🚨 Fleet Safety &amp; Incident Alerts</h1>
          <p className="manga-lead">
            Real-time speed warnings, geofence arrivals, dwell times, off-route deviations, and place triggers. Configure geofences on{" "}
            <Link to="/geofences">Bases &amp; Routes</Link>.
          </p>
        </div>

        {events.length > 0 && (
          <button
            type="button"
            className="manga-btn manga-btn-danger"
            disabled={busyId != null}
            onClick={() => void clearAll()}
          >
            {busyId === "all" ? "Clearing All..." : "🧹 Clear All Fleet Alerts"}
          </button>
        )}
      </div>

      <div className="manga-kpi-grid">
        <div className="manga-kpi">
          <div className="manga-kpi-label">Total Active Alerts</div>
          <div className="manga-kpi-value">{events.length}</div>
        </div>

        <div className={`manga-kpi${speedingCount > 0 ? " manga-kpi--danger" : ""}`}>
          <div className="manga-kpi-label">Speeding Warnings</div>
          <div className="manga-kpi-value">{speedingCount}</div>
        </div>

        <div className="manga-kpi manga-kpi--ok">
          <div className="manga-kpi-label">Geofence Events</div>
          <div className="manga-kpi-value">{geofenceCount}</div>
        </div>

        <div className={`manga-kpi${offRouteCount > 0 ? " manga-kpi--warn" : ""}`}>
          <div className="manga-kpi-label">Off-Route Deviations</div>
          <div className="manga-kpi-value">{offRouteCount}</div>
        </div>
      </div>

      <div className="manga-console">
        <div className="manga-toolbar">
          <div className="manga-filter-row">
            <h2>Alert Log ({filteredEvents.length})</h2>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All Alert Types</option>
              <option value="speed_alert">⚡ Speeding Alerts ({speedingCount})</option>
              <option value="geofence">📍 Geofence Checkpoints ({geofenceCount})</option>
              <option value="off_route">🧭 Off-Route Deviations ({offRouteCount})</option>
            </select>
          </div>

          <div className="manga-filter-row">
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="manga-btn manga-btn-danger"
                onClick={() => void deleteSelected()}
                disabled={busyId != null}
              >
                🗑️ Delete Selected ({selectedIds.size})
              </button>
            )}

            <input
              type="text"
              placeholder="🔍 Search driver or detail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="manga-table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={filteredEvents.length > 0 && selectedIds.size === filteredEvents.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Timestamp</th>
                <th>Alert Type</th>
                <th>Driver</th>
                <th>Incident Detail</th>
                <th>Dwell Time</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem 1rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🟢</div>
                    <strong>No Fleet Alerts Logged</strong>
                    <p className="manga-hero-note" style={{ margin: "0.4rem 0 0" }}>
                      Drivers on duty near a place or exceeding speed limits will generate telemetry alerts here.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredEvents.map((ev) => {
                  const isSelected = selectedIds.has(ev.id);
                  const isSpeeding = ev.type === "speed_alert";
                  const isArrived = ev.type === "place_arrived";
                  const isLeft = ev.type === "place_left";
                  const isOffRoute = ev.type === "off_route";

                  const chipClass = isSpeeding
                    ? "manga-chip manga-chip--danger"
                    : isArrived || isLeft
                    ? "manga-chip manga-chip--ok"
                    : isOffRoute
                    ? "manga-chip"
                    : "manga-chip manga-chip--info";

                  return (
                    <tr key={ev.id} style={isSelected ? { background: "rgba(225, 6, 0, 0.12)" } : undefined}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(ev.id)}
                        />
                      </td>
                      <td>{eventTime(ev)}</td>
                      <td>
                        <span className={chipClass}>{formatFleetEventType(ev.type)}</span>
                      </td>
                      <td><strong>{ev.driverName}</strong></td>
                      <td>{eventMessage(ev)}</td>
                      <td>
                        {isLeft || isArrived || ev.type === "place_dwell"
                          ? formatDwellMs(ev.dwellMs)
                          : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="manga-btn manga-btn-ghost"
                          disabled={busyId != null}
                          onClick={() => void removeEvent(ev)}
                        >
                          {busyId === ev.id ? "..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
