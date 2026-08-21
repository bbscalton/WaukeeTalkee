import { type FormEvent, useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions, ORG_ID } from "../firebase";
import { formatAge, formatSpeed, type Driver } from "../types";

type PairResult = {
  code: string;
  expiresAt: string;
  driverId: string;
  displayName?: string;
};

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPair, setLastPair] = useState<PairResult | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "orgs", ORG_ID, "drivers"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows: Driver[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayName: String(data.displayName || "Driver"),
            plate: data.plate ?? null,
            pairStatus: data.pairStatus === "paired" ? "paired" : "unpaired",
            deviceId: data.deviceId ?? null,
            onDuty: Boolean(data.onDuty),
            lastLat: data.lastLat ?? null,
            lastLng: data.lastLng ?? null,
            lastSpeed: data.lastSpeed ?? null,
            lastHeading: data.lastHeading ?? null,
            lastTelemetryAt: (data.lastTelemetryAt as Timestamp | null) ?? null,
          };
        });
        setDrivers(rows);
      },
      (err) => setError(err.message)
    );
  }, []);

  async function createWithCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "createDriverWithPairCode");
      const res = await fn({
        orgId: ORG_ID,
        displayName: name.trim(),
        plate: plate.trim() || null,
      });
      const data = res.data as PairResult & { displayName: string };
      setLastPair({
        code: data.code,
        expiresAt: data.expiresAt,
        driverId: data.driverId,
        displayName: data.displayName,
      });
      setName("");
      setPlate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCode(driverId: string) {
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "createPairCode");
      const res = await fn({ orgId: ORG_ID, driverId });
      const data = res.data as PairResult;
      setLastPair({ ...data, driverId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pair code failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Drivers</h1>
        <p className="muted">
          Assign a name, generate a pair code, give it to the phone.
        </p>
      </div>

      <form className="panel form-row" onSubmit={createWithCode}>
        <label>
          Driver name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John – Car 12"
            required
          />
        </label>
        <label>
          Plate (optional)
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="ABC 1234"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Working…" : "Create + pair code"}
        </button>
      </form>

      {lastPair && (
        <div className="panel pair-banner">
          <div>
            <p className="muted">Pair code (30 minutes, one use)</p>
            <p className="pair-code">{lastPair.code}</p>
            <p className="muted">
              {lastPair.displayName || lastPair.driverId} · expires{" "}
              {new Date(lastPair.expiresAt).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Duty</th>
              <th>Speed</th>
              <th>Last update</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drivers.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No drivers yet.
                </td>
              </tr>
            )}
            {drivers.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.displayName}</strong>
                  {d.plate && <div className="muted">{d.plate}</div>}
                </td>
                <td>
                  <span className={`pill ${d.pairStatus}`}>{d.pairStatus}</span>
                </td>
                <td>{d.onDuty ? "On duty" : "Off"}</td>
                <td>{formatSpeed(d.lastSpeed)}</td>
                <td>{formatAge(d.lastTelemetryAt)}</td>
                <td>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => void regenerateCode(d.id)}
                  >
                    New code
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
