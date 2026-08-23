import { type FormEvent, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  formatExceptionCode,
  STOP_EXCEPTION_CODES,
  type Driver,
  type Manifest,
  type ManifestStatus,
  type ManifestStop,
  type ManifestStopStatus,
  type StopExceptionCode,
  type Vehicle,
} from "../types";

function mapManifest(id: string, data: Record<string, unknown>): Manifest {
  return {
    id,
    title: String(data.title || "Manifest"),
    driverId: (data.driverId as string | null) ?? null,
    vehicleId: (data.vehicleId as string | null) ?? null,
    status: (data.status as ManifestStatus) || "draft",
    stops: Array.isArray(data.stops) ? (data.stops as ManifestStop[]) : [],
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    updatedAt: (data.updatedAt as Timestamp | null) ?? null,
  };
}

export function ManifestsPage() {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [title, setTitle] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  
  // Stop form
  const [stopAddress, setStopAddress] = useState("");
  const [stopRecipient, setStopRecipient] = useState("");
  const [stopPhone, setStopPhone] = useState("");
  const [draftStops, setDraftStops] = useState<Omit<ManifestStop, "id" | "sequence">[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qM = query(collection(db, "orgs", ORG_ID, "manifests"), orderBy("createdAt", "desc"));
    const unsubM = onSnapshot(qM, (snap) => {
      setManifests(snap.docs.map((d) => mapManifest(d.id, d.data())));
    });

    const qD = query(collection(db, "orgs", ORG_ID, "drivers"));
    const unsubD = onSnapshot(qD, (snap) => {
      setDrivers(
        snap.docs.map((d) => ({
          id: d.id,
          displayName: String(d.data().displayName || "Driver"),
          plate: d.data().plate ?? null,
          pairStatus: d.data().pairStatus === "paired" ? "paired" : "unpaired",
          deviceId: d.data().deviceId ?? null,
          onDuty: Boolean(d.data().onDuty),
          lastLat: null,
          lastLng: null,
          lastSpeed: null,
          lastHeading: null,
          lastTelemetryAt: null,
          speedLimitKmh: null,
        }))
      );
    });

    const qV = query(collection(db, "orgs", ORG_ID, "vehicles"));
    const unsubV = onSnapshot(qV, (snap) => {
      setVehicles(
        snap.docs.map((d) => ({
          id: d.id,
          name: String(d.data().name || "Vehicle"),
          type: d.data().type || "truck",
          plate: String(d.data().plate || ""),
          make: String(d.data().make || ""),
          model: String(d.data().model || ""),
          year: String(d.data().year || ""),
          notes: "",
          assignedDriverId: null,
          createdAt: null,
          updatedAt: null,
        }))
      );
    });

    return () => {
      unsubM();
      unsubD();
      unsubV();
    };
  }, []);

  function addDraftStop() {
    if (!stopAddress.trim()) return;
    setDraftStops((prev) => [
      ...prev,
      {
        address: stopAddress.trim(),
        recipientName: stopRecipient.trim() || "Recipient",
        phone: stopPhone.trim(),
        status: "pending",
      },
    ]);
    setStopAddress("");
    setStopRecipient("");
    setStopPhone("");
  }

  function removeDraftStop(index: number) {
    setDraftStops((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateManifest(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || draftStops.length === 0) {
      setError("Manifest title and at least one stop are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = "mft_" + Date.now();
      const stops: ManifestStop[] = draftStops.map((s, idx) => ({
        id: "stp_" + idx + "_" + Date.now(),
        sequence: idx + 1,
        address: s.address,
        recipientName: s.recipientName,
        phone: s.phone,
        status: s.status,
      }));

      await setDoc(doc(db, "orgs", ORG_ID, "manifests", id), {
        title: title.trim(),
        driverId: driverId || null,
        vehicleId: vehicleId || null,
        status: "draft",
        stops,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      setTitle("");
      setDriverId("");
      setVehicleId("");
      setDraftStops([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create manifest");
    } finally {
      setBusy(false);
    }
  }

  async function updateStopStatus(
    manifest: Manifest,
    stopId: string,
    nextStatus: ManifestStopStatus,
    exceptionCode?: StopExceptionCode | null
  ) {
    setBusy(true);
    setError(null);
    try {
      const updatedStops = manifest.stops.map((s) =>
        s.id === stopId
          ? {
              ...s,
              status: nextStatus,
              exceptionCode: exceptionCode !== undefined ? exceptionCode : s.exceptionCode,
            }
          : s
      );
      await updateDoc(doc(db, "orgs", ORG_ID, "manifests", manifest.id), {
        stops: updatedStops,
        updatedAt: new Date(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stop");
    } finally {
      setBusy(false);
    }
  }

  async function updateManifestStatus(manifestId: string, nextStatus: ManifestStatus) {
    setBusy(true);
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "manifests", manifestId), {
        status: nextStatus,
        updatedAt: new Date(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteManifest(manifestId: string) {
    if (!confirm("Remove this multi-stop route manifest?")) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "manifests", manifestId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete manifest");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Multi-Stop Routes & Manifests</h1>
        <p className="muted">
          Build multi-stop delivery routes, assign truck units and drivers, and track stop exceptions.
        </p>
      </div>

      <form className="panel form-grid" onSubmit={handleCreateManifest}>
        <div className="form-grid-head">
          <strong>Create Route Manifest</strong>
        </div>

        <label>
          Manifest Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Route 4B — Downtown Concrete Pours"
            required
          />
        </label>
        <label>
          Assigned Driver
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Select driver...</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned Vehicle / Unit
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Select vehicle...</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.plate || v.type})
              </option>
            ))}
          </select>
        </label>

        {/* Draft Stops Builder */}
        <div className="span-2 panel" style={{ background: "#12171f", margin: "0.5rem 0" }}>
          <strong>Add Manifest Stops</strong>
          <div className="form-row" style={{ marginTop: "0.5rem" }}>
            <label>
              Stop Address
              <input
                value={stopAddress}
                onChange={(e) => setStopAddress(e.target.value)}
                placeholder="404 Grand Ave, Site #2"
              />
            </label>
            <label>
              Recipient / Site Lead
              <input
                value={stopRecipient}
                onChange={(e) => setStopRecipient(e.target.value)}
                placeholder="Bob Smith"
              />
            </label>
            <button type="button" onClick={addDraftStop} disabled={!stopAddress.trim()}>
              + Add Stop
            </button>
          </div>

          {draftStops.length > 0 && (
            <ol style={{ marginTop: "0.75rem", paddingLeft: "1.2rem" }}>
              {draftStops.map((s, idx) => (
                <li key={idx} style={{ marginBottom: "0.35rem" }}>
                  <strong>{s.address}</strong> — {s.recipientName}
                  <button
                    type="button"
                    className="ghost danger"
                    style={{ marginLeft: "0.5rem", padding: "0.1rem 0.4rem", fontSize: "0.75rem" }}
                    onClick={() => removeDraftStop(idx)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="form-actions span-2">
          <button type="submit" disabled={busy || draftStops.length === 0}>
            {busy ? "Saving…" : "Save Manifest"}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="booking-board">
        {manifests.length === 0 && (
          <div className="panel muted">No active route manifests found.</div>
        )}
        {manifests.map((m) => {
          const assignedD = drivers.find((d) => d.id === m.driverId);
          const assignedV = vehicles.find((v) => v.id === m.vehicleId);
          return (
            <article key={m.id} className="panel booking-card">
              <header className="booking-card-head">
                <div>
                  <h2>{m.title}</h2>
                  <p className="muted">
                    Driver: {assignedD?.displayName || "Unassigned"} · Unit: {assignedV?.name || "Unassigned"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select
                    value={m.status}
                    onChange={(e) => void updateManifestStatus(m.id, e.target.value as ManifestStatus)}
                    style={{ fontSize: "0.82rem", padding: "0.3rem 0.5rem" }}
                  >
                    <option value="draft">Draft</option>
                    <option value="in_transit">In Transit</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => void handleDeleteManifest(m.id)}
                  >
                    Delete
                  </button>
                </div>
              </header>

              <div className="manifest-stops-list">
                <span className="list-label">Stops Manifest ({m.stops.length})</span>
                <table style={{ marginTop: "0.5rem" }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Address</th>
                      <th>Recipient</th>
                      <th>Stop Status</th>
                      <th>Exception</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.stops.map((s) => (
                      <tr key={s.id}>
                        <td><strong>#{s.sequence}</strong></td>
                        <td>{s.address}</td>
                        <td>{s.recipientName}</td>
                        <td>
                          <select
                            value={s.status}
                            onChange={(e) =>
                              void updateStopStatus(m, s.id, e.target.value as ManifestStopStatus)
                            }
                            style={{ fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                          >
                            <option value="pending">Pending</option>
                            <option value="arrived">Arrived</option>
                            <option value="completed">Completed</option>
                            <option value="exception">Exception</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={s.exceptionCode || ""}
                            onChange={(e) => {
                              const code = (e.target.value as StopExceptionCode) || null;
                              void updateStopStatus(
                                m,
                                s.id,
                                code ? "exception" : s.status,
                                code
                              );
                            }}
                            style={{ fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                          >
                            <option value="">None</option>
                            {STOP_EXCEPTION_CODES.map((c) => (
                              <option key={c} value={c}>
                                {formatExceptionCode(c)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
