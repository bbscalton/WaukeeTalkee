import React, { useState, useEffect } from "react";
import { useAuth } from "../auth";
import { db, ORG_ID } from "../firebase";
import {
  collection,
  query,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  orderBy
} from "firebase/firestore";
import { type HazardAlert, type HazardType, formatHazardType } from "../types";

export const HazardsPage: React.FC = () => {
  const { user } = useAuth();
  const [hazards, setHazards] = useState<HazardAlert[]>([]);
  const [loading, setLoading] = useState(true);

  // New Hazard Form State
  const [showModal, setShowModal] = useState(false);
  const [type, setType] = useState<HazardType>("police_checkpoint");
  const [locationName, setLocationName] = useState("");
  const [latStr, setLatStr] = useState("");
  const [lngStr, setLngStr] = useState("");
  const [notes, setNotes] = useState("");
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!ORG_ID) return;

    const q = query(
      collection(db, "orgs", ORG_ID, "hazards"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: HazardAlert[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as HazardAlert[];
      setHazards(list);
      setLoading(false);
    }, (err) => {
      console.error("Error loading hazards:", err);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleCreateHazard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ORG_ID) return;

    const lat = parseFloat(latStr) || 0;
    const lng = parseFloat(lngStr) || 0;

    if (!locationName.trim()) {
      alert("Please enter a location name or intersection.");
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "orgs", ORG_ID, "hazards"), {
        driverId: user?.uid || "dispatch",
        driverName: user?.email || "Dispatch Console",
        type,
        lat,
        lng,
        locationName: locationName.trim(),
        notes: notes.trim(),
        status: "active",
        createdAt: serverTimestamp(),
        confirmedByDispatcher: true,
      });

      setShowModal(false);
      setLocationName("");
      setLatStr("");
      setLngStr("");
      setNotes("");
    } catch (err: any) {
      alert("Failed to report hazard: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearHazard = async (id: string) => {
    if (!ORG_ID) return;
    if (!confirm("Clear this hazard report? Drivers will no longer receive proximity alerts.")) return;

    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "hazards", id), {
        status: "cleared",
      });
    } catch (err: any) {
      alert("Failed to clear hazard: " + err.message);
    }
  };

  const handleConfirmHazard = async (id: string) => {
    if (!ORG_ID) return;
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "hazards", id), {
        confirmedByDispatcher: true,
      });
    } catch (err: any) {
      alert("Failed to confirm hazard: " + err.message);
    }
  };

  const handleBroadcastWarning = async (hazard: HazardAlert) => {
    if (!ORG_ID) return;
    const text = broadcastMsg || `CAUTION: ${formatHazardType(hazard.type)} reported near ${hazard.locationName || 'your area'}. Maintain speed limit!`;
    if (!confirm(`Broadcast warning clip/text to all active drivers?\n\n"${text}"`)) return;

    try {
      await addDoc(collection(db, "orgs", ORG_ID, "broadcasts"), {
        senderName: "Dispatch Patrol Alert",
        message: text,
        severity: "warning",
        createdAt: serverTimestamp(),
      });
      alert("Proximity warning broadcast sent to all drivers!");
      setBroadcastMsg("");
    } catch (err: any) {
      alert("Failed to broadcast warning: " + err.message);
    }
  };

  const activeHazards = hazards.filter((h) => h.status === "active");

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Top Banner Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.8rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            👮 Police Checkpoints & Speed Trap Spotter
          </h1>
          <p style={{ margin: "0.4rem 0 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            Real-time police radar traps, sobriety checkpoints & hazard proximity alerts for fleet drivers.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
          style={{ background: "#ff6b6b", borderColor: "#ff6b6b", fontWeight: 700 }}
        >
          + Report Checkpoint / Speed Trap
        </button>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div className="stat-card" style={{ background: "rgba(255, 107, 107, 0.15)", border: "1px solid rgba(255, 107, 107, 0.3)" }}>
          <div style={{ fontSize: "0.85rem", color: "#ff6b6b", fontWeight: 600 }}>Active Police / Radar Traps</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff" }}>{activeHazards.length}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600 }}>Total Reports Logged</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff" }}>{hazards.length}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600 }}>Proximity Alert Radius</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--amber)" }}>1.5 km (1 mi)</div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem" }}>
        {/* Active Hazards List */}
        <div className="tcd-card full-width">
          <h2>Active Police & Hazard Spotter Reports ({activeHazards.length})</h2>

          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>Loading hazard reports...</div>
          ) : activeHazards.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--muted)" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🛡️</div>
              <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>No Active Police Checkpoints or Speed Traps</div>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
                Drivers and dispatchers can report speed gun traps or police checkpoints to warn approaching drivers.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              {activeHazards.map((h) => (
                <div
                  key={h.id}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: h.type === "police_checkpoint" ? "1px solid #ff6b6b" : "1px solid var(--amber)",
                    borderRadius: "10px",
                    padding: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{
                        padding: "0.2rem 0.6rem",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        background: h.type === "police_checkpoint" ? "rgba(255,107,107,0.2)" : "rgba(255,179,0,0.2)",
                        color: h.type === "police_checkpoint" ? "#ff6b6b" : "var(--amber)",
                      }}>
                        {formatHazardType(h.type)}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {h.confirmedByDispatcher ? "✅ Verified" : "⚠️ Driver Reported"}
                      </span>
                    </div>

                    <h3 style={{ margin: "0.25rem 0", color: "#fff", fontSize: "1.1rem" }}>
                      {h.locationName || "Reported Location"}
                    </h3>

                    {h.notes && (
                      <p style={{ margin: "0.4rem 0", color: "#ccc", fontSize: "0.85rem", fontStyle: "italic" }}>
                        "{h.notes}"
                      </p>
                    )}

                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                      Reported by: <strong>{h.driverName}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {!h.confirmedByDispatcher && (
                      <button
                        onClick={() => handleConfirmHazard(h.id)}
                        className="btn-sm"
                        style={{ background: "#4caf50", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Confirm Report
                      </button>
                    )}
                    <button
                      onClick={() => handleBroadcastWarning(h)}
                      className="btn-sm"
                      style={{ background: "var(--amber)", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                    >
                      📢 Broadcast Warning
                    </button>
                    <button
                      onClick={() => handleClearHazard(h.id)}
                      className="btn-sm"
                      style={{ background: "#444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                    >
                      Clear / Resolved
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Hazard Modal */}
      {showModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "500px", width: "90%" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#fff" }}>Report Police Checkpoint / Speed Trap</h3>
            <form onSubmit={handleCreateHazard}>
              <div className="form-group">
                <label>Hazard Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as HazardType)}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                >
                  <option value="police_checkpoint">👮 Police Checkpoint / Sobriety Station</option>
                  <option value="speed_trap">⚡ Speed Trap / Radar Gun</option>
                  <option value="road_hazard">⚠️ Road Danger / Construction</option>
                  <option value="accident">💥 Traffic Accident</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "0.75rem" }}>
                <label>Location / Intersection Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Highway 65 & Main St Exit"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.75rem" }}>
                <div className="form-group">
                  <label>Latitude (Optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 41.6001"
                    value={latStr}
                    onChange={(e) => setLatStr(e.target.value)}
                    style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                  />
                </div>
                <div className="form-group">
                  <label>Longitude (Optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. -93.6500"
                    value={lngStr}
                    onChange={(e) => setLngStr(e.target.value)}
                    style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "0.75rem" }}>
                <label>Notes / Advice for Drivers</label>
                <input
                  type="text"
                  placeholder="e.g. Police checking speed guns on eastbound lane"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                />
              </div>

              <div className="modal-buttons" style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-sm btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-sm btn-primary"
                  disabled={submitting}
                  style={{ background: "#ff6b6b", borderColor: "#ff6b6b", fontWeight: 700 }}
                >
                  {submitting ? "Publishing..." : "Publish Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
