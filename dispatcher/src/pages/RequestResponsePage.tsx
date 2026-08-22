import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  formatRequestDate,
  formatRequestKind,
  formatRequestStatus,
  formatRequestTime,
  type Driver,
  type RadioRequest,
  type RadioRequestStatus,
} from "../types";
import { useSolutionProfile } from "../useSolutionProfile";

function mapDriver(id: string, data: Record<string, unknown>): Driver {
  return {
    id,
    displayName: String(data.displayName || "Driver"),
    plate: (data.plate as string | null) ?? null,
    pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
    deviceId: (data.deviceId as string | null) ?? null,
    onDuty: Boolean(data.onDuty),
    lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
    lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
    lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
    lastHeading: typeof data.lastHeading === "number" ? data.lastHeading : null,
    lastTelemetryAt: (data.lastTelemetryAt as Timestamp | null) ?? null,
    speedLimitKmh:
      typeof data.speedLimitKmh === "number" ? data.speedLimitKmh : null,
  };
}

function mapRequest(id: string, data: Record<string, unknown>): RadioRequest {
  const statusRaw = String(data.status || "pending");
  const status: RadioRequestStatus =
    statusRaw === "responded" || statusRaw === "expired"
      ? statusRaw
      : "pending";
  const kindRaw = String(data.kind || "direct");
  return {
    id,
    kind: kindRaw === "broadcast" ? "broadcast" : "direct",
    driverId: String(data.driverId || ""),
    driverName: String(data.driverName || "Driver"),
    outboundClipId: String(data.outboundClipId || ""),
    replyClipId: data.replyClipId ? String(data.replyClipId) : null,
    status,
    createdAt: (data.createdAt as RadioRequest["createdAt"]) ?? null,
    expiresAt: (data.expiresAt as RadioRequest["expiresAt"]) ?? null,
    respondedAt: (data.respondedAt as RadioRequest["respondedAt"]) ?? null,
    broadcastBatchId: data.broadcastBatchId
      ? String(data.broadcastBatchId)
      : null,
    groupId: data.groupId ? String(data.groupId) : null,
  };
}

function effectiveStatus(req: RadioRequest): RadioRequestStatus {
  if (req.status !== "pending") return req.status;
  if (!req.expiresAt || typeof req.expiresAt.seconds !== "number") {
    return req.status;
  }
  if (Date.now() > req.expiresAt.seconds * 1000) return "expired";
  return "pending";
}

export function RequestResponsePage() {
  const { label, profile } = useSolutionProfile();
  const isConcrete = profile.id === "concrete";
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [requests, setRequests] = useState<RadioRequest[]>([]);
  const [driverFilter, setDriverFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => mapDriver(d.id, d.data() as Record<string, unknown>))
      );
    });
  }, []);

  useEffect(() => {
    const base = collection(db, "orgs", ORG_ID, "radioRequests");
    const q = driverFilter
      ? query(
          base,
          where("driverId", "==", driverFilter),
          orderBy("createdAt", "desc")
        )
      : query(base, orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setRequests(
          snap.docs.map((d) =>
            mapRequest(d.id, d.data() as Record<string, unknown>)
          )
        );
        setError(null);
      },
      (err) => setError(err.message)
    );
  }, [driverFilter]);

  const paired = useMemo(
    () =>
      [...drivers]
        .filter((d) => d.pairStatus === "paired")
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [drivers]
  );

  const rows = useMemo(() => {
    return requests.map((req) => ({
      ...req,
      displayStatus: effectiveStatus(req),
    }));
  }, [requests]);

  const pendingCount = rows.filter((r) => r.displayStatus === "pending").length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{label("requestResponse")}</h1>
          <p className="muted">
            {isConcrete
              ? "Radio call-outs to drivers and crew. A reply within 3 minutes is logged as confirmed."
              : "Direct push-to-talk to a selected driver counts as a request. A driver reply within 3 minutes is logged as a response. Fleet broadcasts track responses from on-duty drivers only."}
          </p>
        </div>
      </header>

      <div className="panel form-grid">
        <label>
          Driver
          <select
            value={driverFilter}
            onChange={(e) => setDriverFilter(e.target.value)}
          >
            <option value="">All drivers</option>
            {paired.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
                {d.onDuty ? " · on duty" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Select a driver on the Radio map before push-to-talk to create a direct
          request. Broadcast responses apply to on-duty drivers only.
          {pendingCount > 0 && (
            <>
              {" "}
              · <strong>{pendingCount}</strong> awaiting response
            </>
          )}
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Date</th>
              <th>Time</th>
              <th>Type</th>
              <th>Response</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No requests yet. Select a driver on the map and hold push-to-talk,
                  or use fleet broadcast for on-duty response tracking.
                </td>
              </tr>
            ) : (
              rows.map((req) => (
                <tr key={req.id}>
                  <td>{req.driverName}</td>
                  <td>{formatRequestDate(req.createdAt)}</td>
                  <td>{formatRequestTime(req.createdAt)}</td>
                  <td>{formatRequestKind(req.kind)}</td>
                  <td
                    className={
                      req.displayStatus === "responded"
                        ? "status-ok"
                        : req.displayStatus === "pending"
                          ? "status-warn"
                          : "muted"
                    }
                  >
                    {formatRequestStatus(req.displayStatus, req.respondedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
