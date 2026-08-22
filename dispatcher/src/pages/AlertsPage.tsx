import { useEffect, useState } from "react";
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

  useEffect(() => {
    markSeen();
  }, [markSeen, events.length]);

  const removeEvent = async (ev: FleetEvent) => {
    if (
      !window.confirm(
        `Delete this ${formatFleetEventType(ev.type).toLowerCase()} alert for ${ev.driverName}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(ev.id);
    try {
      await deleteFleetEvent(ev.id);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not delete alert."
      );
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    if (events.length === 0) return;
    if (
      !window.confirm(
        "Delete ALL fleet alerts for this organization? This cannot be undone."
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        "Final confirmation: clear every arrive / dwell / leave / off-route / speed alert?"
      )
    ) {
      return;
    }
    setBusyId("all");
    try {
      await clearAllFleetEvents();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not clear alerts."
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head alerts-page-head">
        <div>
          <h1>Fleet alerts</h1>
          <p className="muted">
            Arrive / dwell / leave at bases &amp; checkpoints, off-route, and
            speed alerts (last ~7 days). Configure places and routes on{" "}
            <Link to="/geofences">Bases &amp; routes</Link>.
          </p>
        </div>
        {events.length > 0 && (
          <button
            type="button"
            className="ghost danger-ghost"
            disabled={busyId != null}
            onClick={() => void clearAll()}
          >
            {busyId === "all" ? "Clearing…" : "Clear all alerts"}
          </button>
        )}
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Driver</th>
              <th>Detail</th>
              <th>Dwell</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No alerts yet. Drivers on duty near a place will generate
                  arrivals after ~20s inside the fence.
                </td>
              </tr>
            )}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="muted">{eventTime(ev)}</td>
                <td>
                  <span className={`pill fleet-pill fleet-pill-${ev.type}`}>
                    {formatFleetEventType(ev.type)}
                  </span>
                </td>
                <td>
                  <strong>{ev.driverName}</strong>
                </td>
                <td>{eventMessage(ev)}</td>
                <td>
                  {ev.type === "place_left" ||
                  ev.type === "place_dwell" ||
                  ev.type === "place_arrived"
                    ? formatDwellMs(ev.dwellMs)
                    : "—"}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="ghost danger-ghost"
                    disabled={busyId != null}
                    onClick={() => void removeEvent(ev)}
                  >
                    {busyId === ev.id ? "…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
