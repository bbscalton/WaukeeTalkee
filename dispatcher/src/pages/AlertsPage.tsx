import { useEffect } from "react";
import { Link } from "react-router-dom";
import { eventMessage, useFleetAlerts } from "../FleetAlertsProvider";
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

  useEffect(() => {
    markSeen();
  }, [markSeen, events.length]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Fleet alerts</h1>
        <p className="muted">
          Arrive / dwell / leave at bases &amp; checkpoints, off-route, and speed
          alerts (last ~7 days). Configure places and routes on{" "}
          <Link to="/geofences">Bases &amp; routes</Link>.
        </p>
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
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
