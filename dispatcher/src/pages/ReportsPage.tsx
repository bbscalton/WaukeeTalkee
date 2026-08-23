import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  formatExceptionCode,
  type Booking,
  type Driver,
  type Manifest,
  type SosEvent,
} from "../types";

export function ReportsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([]);

  useEffect(() => {
    const unsubB = onSnapshot(collection(db, "orgs", ORG_ID, "bookings"), (snap) => {
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking)));
    });

    const unsubD = onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Driver)));
    });

    const unsubM = onSnapshot(collection(db, "orgs", ORG_ID, "manifests"), (snap) => {
      setManifests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Manifest)));
    });

    const unsubS = onSnapshot(collection(db, "orgs", ORG_ID, "sosEvents"), (snap) => {
      setSosEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SosEvent)));
    });

    return () => {
      unsubB();
      unsubD();
      unsubM();
      unsubS();
    };
  }, []);

  // Compute Metrics
  const totalBookings = bookings.length;
  const completedBookings = bookings.filter((b) => b.status === "completed").length;
  const completionRate = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;
  
  const exceptionBookings = bookings.filter((b) => Boolean(b.exceptionCode));
  const activeSosCount = sosEvents.filter((s) => !s.resolvedAt).length;
  const onDutyDrivers = drivers.filter((d) => d.onDuty).length;

  // Exception Summary Count
  const exceptionCounts: Record<string, number> = {};
  bookings.forEach((b) => {
    if (b.exceptionCode) {
      const label = formatExceptionCode(b.exceptionCode);
      exceptionCounts[label] = (exceptionCounts[label] || 0) + 1;
    }
  });

  function exportBookingsCsv() {
    if (bookings.length === 0) return alert("No booking data available to export.");
    const headers = ["ID", "Passenger Name", "Pickup", "Dropoff", "Status", "Driver ID", "Exception Code", "Attachments Count"];
    const rows = bookings.map((b) => [
      b.id,
      `"${(b.passengerName || "").replace(/"/g, '""')}"`,
      `"${(b.pickupAddress || "").replace(/"/g, '""')}"`,
      `"${(b.dropoffAddress || "").replace(/"/g, '""')}"`,
      b.status,
      b.assignedDriverId || "Unassigned",
      b.exceptionCode || "None",
      b.attachments ? b.attachments.length : 0,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadFile(csvContent, `bookings_report_${ORG_ID}_${Date.now()}.csv`, "text/csv");
  }

  function exportManifestsCsv() {
    if (manifests.length === 0) return alert("No manifest data available to export.");
    const headers = ["Manifest ID", "Title", "Status", "Driver ID", "Total Stops"];
    const rows = manifests.map((m) => [
      m.id,
      `"${(m.title || "").replace(/"/g, '""')}"`,
      m.status,
      m.driverId || "Unassigned",
      m.stops ? m.stops.length : 0,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadFile(csvContent, `manifests_report_${ORG_ID}_${Date.now()}.csv`, "text/csv");
  }

  function downloadFile(content: string, fileName: string, contentType: string) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Operational Reporting Dashboard</h1>
        <p className="muted">
          Analyze fleet performance metrics, stop exception trends, SOS emergency logs, and export raw CSV records.
        </p>
      </div>

      {/* Metric KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        <div className="panel" style={{ background: "#0d131c", borderLeft: "4px solid var(--amber)" }}>
          <span className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
            Total Bookings / Jobs
          </span>
          <h2 style={{ fontSize: "2rem", margin: "0.25rem 0 0 0" }}>{totalBookings}</h2>
          <div style={{ fontSize: "0.8rem", color: "#4caf50", marginTop: "0.25rem" }}>
            {completedBookings} Completed ({completionRate}%)
          </div>
        </div>

        <div className="panel" style={{ background: "#0d131c", borderLeft: "4px solid #4caf50" }}>
          <span className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
            Active Drivers On Duty
          </span>
          <h2 style={{ fontSize: "2rem", margin: "0.25rem 0 0 0" }}>{onDutyDrivers}</h2>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Out of {drivers.length} registered
          </div>
        </div>

        <div className="panel" style={{ background: "#0d131c", borderLeft: "4px solid #ff9800" }}>
          <span className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
            Stop Exceptions Flagged
          </span>
          <h2 style={{ fontSize: "2rem", margin: "0.25rem 0 0 0" }}>{exceptionBookings.length}</h2>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Site detention / delays
          </div>
        </div>

        <div className="panel" style={{ background: "#0d131c", borderLeft: `4px solid ${activeSosCount > 0 ? "#d32f2f" : "#2196f3"}` }}>
          <span className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase" }}>
            Active Panic SOS Alerts
          </span>
          <h2 style={{ fontSize: "2rem", margin: "0.25rem 0 0 0" }}>{activeSosCount}</h2>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            {sosEvents.length} Total SOS incidents
          </div>
        </div>
      </div>

      <div className="grid-2col" style={{ marginTop: "1.5rem" }}>
        {/* Exception Summary Breakdown */}
        <div className="panel">
          <h2>Stop Exceptions Summary</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Breakdown of job delays and site exceptions logged by dispatchers.
          </p>

          <table style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Exception Code</th>
                <th>Total Occurrences</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(exceptionCounts).length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No exceptions logged yet.
                  </td>
                </tr>
              )}
              {Object.entries(exceptionCounts).map(([code, count]) => (
                <tr key={code}>
                  <td><strong>⚠️ {code}</strong></td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Data Export & Reports Panel */}
        <div className="panel">
          <h2>CSV Data Exporter</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Export live organization data to raw CSV files for offline audit, payroll, and billing compliance.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1319", padding: "0.75rem", borderRadius: "6px" }}>
              <div>
                <strong>Bookings & Job Dispatch Report</strong>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Includes addresses, status, exception codes & attachments count</div>
              </div>
              <button type="button" onClick={exportBookingsCsv}>
                📥 Download CSV
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1319", padding: "0.75rem", borderRadius: "6px" }}>
              <div>
                <strong>Multi-Stop Route Manifests Report</strong>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Includes title, driver/vehicle pairing, and total stop counts</div>
              </div>
              <button type="button" onClick={exportManifestsCsv}>
                📥 Download CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
