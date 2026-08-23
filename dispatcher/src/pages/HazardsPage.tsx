import React, { useState, useEffect, useRef } from "react";
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
import { HazardMap, type HazardMapHandle } from "../components/HazardMap";

export const HazardsPage: React.FC = () => {
  const { user } = useAuth();
  const [hazards, setHazards] = useState<HazardAlert[]>([]);
  const [loading, setLoading] = useState(true);

  // Map state & references
  const hazardMapRef = useRef<HazardMapHandle | null>(null);
  const [mapMode, setMapMode] = useState<"streets" | "satellite">("satellite");
  const [isPickMode, setIsPickMode] = useState(false);
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);

  // Filters & Search
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Report Modal / Panel State
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

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: HazardAlert[] = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as HazardAlert[];
        setHazards(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading hazards:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Handle map click reverse geocoding callback
  const handleMapPickLocation = (lat: number, lng: number, address: string) => {
    setLatStr(lat.toFixed(6));
    setLngStr(lng.toFixed(6));
    setLocationName(address);
    if (!showModal) {
      setShowModal(true);
    }
  };

  const togglePickMode = () => {
    const nextMode = !isPickMode;
    setIsPickMode(nextMode);
    hazardMapRef.current?.setPickMode(nextMode, type);
  };

  const handleCreateHazard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ORG_ID) return;

    const lat = parseFloat(latStr) || 0;
    const lng = parseFloat(lngStr) || 0;

    if (!locationName.trim()) {
      alert("Please enter or pick a location name/intersection.");
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "orgs", ORG_ID, "hazards"), {
        driverId: user?.uid || "dispatch",
        driverName: user?.email ? user.email.split("@")[0] : "Dispatch Console",
        type,
        lat,
        lng,
        locationName: locationName.trim(),
        notes: notes.trim(),
        status: "active",
        createdAt: serverTimestamp(),
        confirmedByDispatcher: true,
      });

      // Cleanup form and pin mode
      setShowModal(false);
      setIsPickMode(false);
      hazardMapRef.current?.setPickMode(false, type);
      hazardMapRef.current?.clearPickMarker();
      setLocationName("");
      setLatStr("");
      setLngStr("");
      setNotes("");
    } catch (err: any) {
      alert("Failed to publish report: " + err.message);
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
    const text =
      broadcastMsg ||
      `CAUTION: ${formatHazardType(hazard.type)} reported near ${hazard.locationName || "your area"}. Maintain safe speed limit!`;

    if (!confirm(`Broadcast police siren warning clip/text to all active fleet drivers?\n\n"${text}"`)) return;

    try {
      await addDoc(collection(db, "orgs", ORG_ID, "broadcasts"), {
        senderName: "Dispatch Patrol Alert",
        message: text,
        severity: "warning",
        createdAt: serverTimestamp(),
      });
      alert("📢 Police warning siren & alert message broadcasted to all active driver devices!");
      setBroadcastMsg("");
    } catch (err: any) {
      alert("Failed to broadcast warning: " + err.message);
    }
  };

  const activeHazards = hazards.filter((h) => h.status === "active");
  const filteredHazards = activeHazards.filter((h) => {
    const matchesType =
      filterType === "all"
        ? true
        : filterType === "unconfirmed"
        ? !h.confirmedByDispatcher
        : h.type === filterType;

    const matchesSearch =
      !searchQuery.trim() ||
      h.locationName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.driverName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.notes?.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesType && matchesSearch;
  });

  const policeCount = activeHazards.filter((h) => h.type === "police_checkpoint" || h.type === "speed_trap").length;
  const unconfirmedCount = activeHazards.filter((h) => !h.confirmedByDispatcher).length;

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.8rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.6rem" }}>
            👮 Police Radar Trap & Checkpoint Dispatch Command
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>
            Live map pinpointing, police siren broadcast triggers, and real-time proximity alerts.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={togglePickMode}
            className="btn"
            style={{
              background: isPickMode ? "#ff9f43" : "rgba(255, 159, 67, 0.15)",
              color: isPickMode ? "#000" : "#ff9f43",
              border: "1px solid #ff9f43",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.4rem"
            }}
          >
            {isPickMode ? "📍 Click Map to Place Marker (Active)" : "📍 Drop Pin on Map"}
          </button>
          <button
            onClick={() => {
              setShowModal(true);
              setIsPickMode(true);
              hazardMapRef.current?.setPickMode(true, type);
            }}
            className="btn btn-primary"
            style={{ background: "#ff6b6b", borderColor: "#ff6b6b", fontWeight: 700 }}
          >
            + Report Checkpoint / Radar Trap
          </button>
        </div>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div className="stat-card" style={{ background: "rgba(255, 107, 107, 0.15)", border: "1px solid rgba(255, 107, 107, 0.3)" }}>
          <div style={{ fontSize: "0.85rem", color: "#ff6b6b", fontWeight: 600 }}>Active Police / Speed Traps</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff" }}>{policeCount}</div>
        </div>
        <div className="stat-card" style={{ background: unconfirmedCount > 0 ? "rgba(255, 179, 0, 0.15)" : undefined, border: unconfirmedCount > 0 ? "1px solid rgba(255, 179, 0, 0.4)" : undefined }}>
          <div style={{ fontSize: "0.85rem", color: unconfirmedCount > 0 ? "var(--amber)" : "var(--muted)", fontWeight: 600 }}>Awaiting Verification</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff" }}>{unconfirmedCount}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600 }}>Total Active Hazards</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#fff" }}>{activeHazards.length}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 600 }}>Driver Warning Radius</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--amber)" }}>1.5 km (1 mi)</div>
        </div>
      </div>

      {/* Live Map Panel */}
      <div className="tcd-card full-width" style={{ marginBottom: "1.5rem", padding: "1rem", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              🗺️ Tactical Checkpoint Map
            </h2>
            {isPickMode && (
              <span style={{ background: "#ff9f43", color: "#000", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, animation: "pulse 1.5s infinite" }}>
                🎯 CLICK ANYWHERE ON MAP TO SET REPORT LOCATION
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              className={`btn-sm ${mapMode === "streets" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapMode("streets")}
            >
              Streets
            </button>
            <button
              className={`btn-sm ${mapMode === "satellite" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapMode("satellite")}
            >
              Satellite
            </button>
          </div>
        </div>

        {/* Map Container */}
        <div style={{ width: "100%", height: "420px", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--line)" }}>
          <HazardMap
            ref={hazardMapRef}
            hazards={hazards}
            mapMode={mapMode}
            onPickLocation={handleMapPickLocation}
            onConfirm={handleConfirmHazard}
            onBroadcast={handleBroadcastWarning}
            onClear={handleClearHazard}
          />
        </div>
      </div>

      {/* Hazards Controls & List Section */}
      <div className="tcd-card full-width">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
          <h2>Active Reports & Police Alerts ({filteredHazards.length})</h2>

          {/* Filter & Search Bar */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="🔍 Search location or driver..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.45rem 0.8rem",
                borderRadius: "8px",
                background: "var(--asphalt)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem",
                minWidth: "220px"
              }}
            />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{
                padding: "0.45rem 0.8rem",
                borderRadius: "8px",
                background: "var(--asphalt)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem"
              }}
            >
              <option value="all">All Active Reports</option>
              <option value="unconfirmed">⚠️ Needs Dispatch Verification ({unconfirmedCount})</option>
              <option value="police_checkpoint">👮 Police Checkpoints</option>
              <option value="speed_trap">⚡ Radar Speed Traps</option>
              <option value="road_hazard">⚠️ Road Danger</option>
              <option value="accident">💥 Traffic Accidents</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>Loading active reports...</div>
        ) : filteredHazards.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--muted)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🛡️</div>
            <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>No Matching Hazards Found</div>
            <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
              Use "+ Report Checkpoint" or click "Drop Pin on Map" to publish a report.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1rem" }}>
            {filteredHazards.map((h) => (
              <div
                key={h.id}
                onClick={() => {
                  setSelectedHazardId(h.id);
                  hazardMapRef.current?.focusHazard(h);
                }}
                style={{
                  background: selectedHazardId === h.id ? "rgba(255, 107, 107, 0.12)" : "rgba(255, 255, 255, 0.03)",
                  border: selectedHazardId === h.id ? "2px solid #ff6b6b" : h.type === "police_checkpoint" ? "1px solid #ff6b6b" : "1px solid var(--amber)",
                  borderRadius: "10px",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span style={{
                      padding: "0.25rem 0.6rem",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      background: h.type === "police_checkpoint" ? "rgba(255,107,107,0.2)" : "rgba(255,179,0,0.2)",
                      color: h.type === "police_checkpoint" ? "#ff6b6b" : "var(--amber)",
                    }}>
                      {formatHazardType(h.type)}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: h.confirmedByDispatcher ? "#4caf50" : "var(--amber)", fontWeight: 700 }}>
                      {h.confirmedByDispatcher ? "✅ Confirmed Accurate" : "⚠️ Driver Reported"}
                    </span>
                  </div>

                  <h3 style={{ margin: "0.3rem 0", color: "#fff", fontSize: "1.1rem" }}>
                    {h.locationName || "Reported Location"}
                  </h3>

                  {h.notes && (
                    <p style={{ margin: "0.4rem 0", color: "#ccc", fontSize: "0.85rem", fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "0.4rem 0.6rem", borderRadius: "6px" }}>
                      "{h.notes}"
                    </p>
                  )}

                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                    Reported by: <strong>{h.driverName}</strong>
                    {h.lat && h.lng ? ` · (${h.lat.toFixed(4)}, ${h.lng.toFixed(4)})` : ""}
                  </div>
                </div>

                <div
                  style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!h.confirmedByDispatcher && (
                    <button
                      onClick={() => handleConfirmHazard(h.id)}
                      className="btn-sm"
                      style={{ background: "#4caf50", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                    >
                      Confirm Accuracy
                    </button>
                  )}
                  <button
                    onClick={() => handleBroadcastWarning(h)}
                    className="btn-sm"
                    style={{ background: "var(--amber)", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                  >
                    📢 Broadcast Siren
                  </button>
                  <button
                    onClick={() => handleClearHazard(h.id)}
                    className="btn-sm"
                    style={{ background: "#444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Hazard Modal */}
      {showModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "550px", width: "90%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff" }}>Report Police Checkpoint / Speed Trap</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ background: "rgba(255,159,67,0.15)", border: "1px solid #ff9f43", padding: "0.6rem 0.8rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85rem", color: "#ff9f43" }}>
              💡 <strong>Tip:</strong> Click anywhere directly on the map to automatically pin precise coordinates and street name!
            </div>

            <form onSubmit={handleCreateHazard}>
              <div className="form-group">
                <label>Hazard Type</label>
                <select
                  value={type}
                  onChange={(e) => {
                    const newType = e.target.value as HazardType;
                    setType(newType);
                    hazardMapRef.current?.setPickMode(true, newType);
                  }}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                >
                  <option value="police_checkpoint">👮 Police Checkpoint / Sobriety Station</option>
                  <option value="speed_trap">⚡ Radar Speed Trap</option>
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
                  <label>Latitude</label>
                  <input
                    type="text"
                    placeholder="Click map or enter lat"
                    value={latStr}
                    onChange={(e) => setLatStr(e.target.value)}
                    style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "var(--asphalt)", color: "#fff", border: "1px solid var(--line)" }}
                  />
                </div>
                <div className="form-group">
                  <label>Longitude</label>
                  <input
                    type="text"
                    placeholder="Click map or enter lng"
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
                  onClick={() => {
                    setShowModal(false);
                    setIsPickMode(false);
                    hazardMapRef.current?.setPickMode(false, type);
                  }}
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
