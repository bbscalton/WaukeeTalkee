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
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              Fleet Telemetry Monitor
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Automatic 7-Day Retention Rolling Archive
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2rem", color: "#fff", fontWeight: 800 }}>
            🚨 Fleet Safety & Incident Alerts
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Real-time speed warnings, geofence arrivals, dwell times, off-route deviations, and place triggers. Configure geofences on{" "}
            <Link to="/geofences" style={{ color: "#60a5fa", textDecoration: "underline" }}>Bases &amp; Routes</Link>.
          </p>
        </div>

        {events.length > 0 && (
          <button
            type="button"
            disabled={busyId != null}
            onClick={() => void clearAll()}
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              fontWeight: 800,
              padding: "0.7rem 1.2rem",
              borderRadius: "10px",
              fontSize: "0.85rem",
              cursor: "pointer"
            }}
          >
            {busyId === "all" ? "Clearing All..." : "🧹 Clear All Fleet Alerts"}
          </button>
        )}
      </div>

      {/* KPI Telemetry Dashboard */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "rgba(59, 130, 246, 0.12)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: 700 }}>Total Active Alerts</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{events.length}</div>
        </div>

        <div style={{ background: speedingCount > 0 ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.03)", border: speedingCount > 0 ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: speedingCount > 0 ? "#ef4444" : "var(--muted)", fontWeight: 700 }}>Speeding Warnings</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: speedingCount > 0 ? "#ef4444" : "#fff", marginTop: "0.2rem" }}>{speedingCount}</div>
        </div>

        <div style={{ background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>Geofence Events</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{geofenceCount}</div>
        </div>

        <div style={{ background: offRouteCount > 0 ? "rgba(245, 158, 11, 0.12)" : "rgba(255, 255, 255, 0.03)", border: offRouteCount > 0 ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: offRouteCount > 0 ? "#f59e0b" : "var(--muted)", fontWeight: 700 }}>Off-Route Deviations</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{offRouteCount}</div>
        </div>
      </div>

      {/* Main Table Container */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
        
        {/* Controls Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
              Alert Log ({filteredEvents.length})
            </h2>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem"
              }}
            >
              <option value="all">All Alert Types</option>
              <option value="speed_alert">⚡ Speeding Alerts ({speedingCount})</option>
              <option value="geofence">📍 Geofence Checkpoints ({geofenceCount})</option>
              <option value="off_route">🧭 Off-Route Deviations ({offRouteCount})</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={busyId != null}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.55rem 0.9rem",
                  fontSize: "0.85rem",
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                🗑️ Delete Selected ({selectedIds.size})
              </button>
            )}

            <input
              type="text"
              placeholder="🔍 Search driver or detail..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem",
                minWidth: "220px"
              }}
            />
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 0.5rem" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.75rem 0.5rem", width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={filteredEvents.length > 0 && selectedIds.size === filteredEvents.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th style={{ padding: "0.75rem 1rem" }}>Timestamp</th>
                <th style={{ padding: "0.75rem 1rem" }}>Alert Type</th>
                <th style={{ padding: "0.75rem 1rem" }}>Driver</th>
                <th style={{ padding: "0.75rem 1rem" }}>Incident Detail</th>
                <th style={{ padding: "0.75rem 1rem" }}>Dwell Time</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3.5rem", color: "var(--muted)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🟢</div>
                    <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>No Fleet Alerts Logged</div>
                    <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.85rem" }}>
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

                  return (
                    <tr
                      key={ev.id}
                      style={{
                        background: isSelected
                          ? "rgba(59, 130, 246, 0.2)"
                          : isSpeeding
                          ? "rgba(239, 68, 68, 0.12)"
                          : isOffRoute
                          ? "rgba(245, 158, 11, 0.12)"
                          : isArrived
                          ? "rgba(34, 197, 94, 0.05)"
                          : "rgba(255, 255, 255, 0.02)",
                        borderLeft: isSpeeding
                          ? "4px solid #ef4444"
                          : isOffRoute
                          ? "4px solid #f59e0b"
                          : isArrived
                          ? "4px solid #22c55e"
                          : "4px solid #3b82f6",
                        borderRadius: "8px"
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: "0.85rem 0.5rem", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(ev.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>

                      {/* Timestamp */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                        {eventTime(ev)}
                      </td>

                      {/* Alert Type */}
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <span style={{
                          padding: "0.25rem 0.65rem",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 800,
                          background: isSpeeding
                            ? "rgba(239, 68, 68, 0.2)"
                            : isArrived
                            ? "rgba(34, 197, 94, 0.2)"
                            : isOffRoute
                            ? "rgba(245, 158, 11, 0.2)"
                            : "rgba(59, 130, 246, 0.2)",
                          color: isSpeeding
                            ? "#ef4444"
                            : isArrived
                            ? "#4ade80"
                            : isOffRoute
                            ? "#f59e0b"
                            : "#60a5fa",
                        }}>
                          {formatFleetEventType(ev.type)}
                        </span>
                      </td>

                      {/* Driver */}
                      <td style={{ padding: "0.85rem 1rem", fontWeight: 800, color: "#fff" }}>
                        {ev.driverName}
                      </td>

                      {/* Incident Detail */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.9rem", color: "#e2e8f0" }}>
                        {eventMessage(ev)}
                      </td>

                      {/* Dwell Time */}
                      <td style={{ padding: "0.85rem 1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                        {isLeft || isArrived || ev.type === "place_dwell"
                          ? formatDwellMs(ev.dwellMs)
                          : "—"}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "0.85rem 1rem", textAlign: "right" }}>
                        <button
                          type="button"
                          disabled={busyId != null}
                          onClick={() => void removeEvent(ev)}
                          style={{
                            background: "rgba(239, 68, 68, 0.12)",
                            color: "#ef4444",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                            borderRadius: "6px",
                            padding: "0.35rem 0.65rem",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
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
