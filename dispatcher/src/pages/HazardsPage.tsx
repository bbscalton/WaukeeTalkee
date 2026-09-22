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

  // Report Form State
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

  // Handle map click location pin callback
  const handleMapPickLocation = (lat: number, lng: number, address: string) => {
    setLatStr(lat.toFixed(6));
    setLngStr(lng.toFixed(6));
    setLocationName(address);
    if (!showModal) {
      setShowModal(true);
    }
  };

  const startQuickPinDrop = (selectedType: HazardType) => {
    setType(selectedType);
    setIsPickMode(true);
    hazardMapRef.current?.setPickMode(true, selectedType);
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
      alert("Please enter or pick a location name/intersection on the map.");
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "orgs", ORG_ID, "hazards"), {
        driverId: user?.uid || "dispatch",
        driverName: user?.email ? user.email.split("@")[0] : "Dispatch Patrol",
        type,
        lat,
        lng,
        locationName: locationName.trim(),
        notes: notes.trim(),
        status: "active",
        createdAt: serverTimestamp(),
        confirmedByDispatcher: true,
      });

      // Reset Form State
      setShowModal(false);
      setIsPickMode(false);
      hazardMapRef.current?.setPickMode(false, type);
      hazardMapRef.current?.clearPickMarker();
      setLocationName("");
      setLatStr("");
      setLngStr("");
      setNotes("");
    } catch (err: any) {
      alert("Failed to publish hazard report: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearHazard = async (id: string) => {
    if (!ORG_ID) return;
    if (!confirm("Clear this hazard report? Approaching drivers will no longer receive sirens or proximity warnings.")) return;

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

    if (!confirm(`Broadcast police siren audio warning to all active fleet driver phones?\n\n"${text}"`)) return;

    try {
      await addDoc(collection(db, "orgs", ORG_ID, "broadcasts"), {
        senderName: "Dispatch Patrol Alert",
        message: text,
        severity: "warning",
        createdAt: serverTimestamp(),
      });
      alert("📢 Police warning siren & notification broadcasted to all active driver devices!");
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
    <div className="manga-page">
      <div className="manga-hero">
        <div>
          <div className="manga-hero-meta">
            <span className="manga-chip manga-chip--danger">Live Patrol Radar</span>
            <span className="manga-hero-note">
              Proximity Alert Radius: <strong>1.5 km (1 mi)</strong>
            </span>
          </div>
          <h1 className="manga-title">👮 Police Radar Trap & Checkpoint Command</h1>
          <p className="manga-lead">
            Tactical map, pin placement, real-time driver sirens & proximity hazard warnings.
          </p>
        </div>

        <div className="manga-filter-row">
          <button
            type="button"
            className={`manga-btn ${isPickMode ? "manga-btn-primary" : "manga-btn-ghost"}`}
            onClick={togglePickMode}
          >
            {isPickMode ? "🎯 Map Targeting Mode Active" : "📍 Drop Pin on Map"}
          </button>
          <button
            type="button"
            className="manga-btn manga-btn-danger"
            onClick={() => {
              setShowModal(true);
              setIsPickMode(true);
              hazardMapRef.current?.setPickMode(true, type);
            }}
          >
            + Report Speed Trap / Checkpoint
          </button>
        </div>
      </div>

      <div className="manga-kpi-grid">
        <div className="manga-kpi manga-kpi--danger">
          <div className="manga-kpi-label">Active Police & Radar Traps</div>
          <div className="manga-kpi-value">{policeCount}</div>
        </div>
        <div className={`manga-kpi${unconfirmedCount > 0 ? " manga-kpi--warn" : ""}`}>
          <div className="manga-kpi-label">Awaiting Verification</div>
          <div className="manga-kpi-value">{unconfirmedCount}</div>
        </div>
        <div className="manga-kpi">
          <div className="manga-kpi-label">Total Active Hazards</div>
          <div className="manga-kpi-value">{activeHazards.length}</div>
        </div>
        <div className="manga-kpi manga-kpi--ok">
          <div className="manga-kpi-label">Automatic Driver Siren</div>
          <div className="manga-kpi-value" style={{ fontSize: "1.5rem" }}>ENABLED 🔊</div>
        </div>
      </div>

      <div className="manga-console" style={{ position: "relative" }}>
        <div className="manga-toolbar">
          <div className="manga-hero-meta">
            <h2 style={{ margin: 0 }}>🗺️ Tactical Map Pinpoint Console</h2>
            {isPickMode && (
              <span className="manga-chip">🎯 CLICK MAP TO LOCK HAZARD LOCATION</span>
            )}
          </div>

          <div className="manga-filter-row">
            <span className="manga-hero-note">Quick Pin:</span>
            <button
              type="button"
              className="manga-btn manga-btn-danger"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
              onClick={() => startQuickPinDrop("police_checkpoint")}
            >
              👮 Police
            </button>
            <button
              type="button"
              className="manga-btn manga-btn-primary"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
              onClick={() => startQuickPinDrop("speed_trap")}
            >
              ⚡ Radar Trap
            </button>
            <button
              type="button"
              className="manga-btn manga-btn-ghost"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
              onClick={() => startQuickPinDrop("road_hazard")}
            >
              ⚠️ Road Danger
            </button>

            <button
              type="button"
              className={`manga-btn ${mapMode === "streets" ? "manga-btn-primary" : "manga-btn-ghost"}`}
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
              onClick={() => setMapMode("streets")}
            >
              Streets
            </button>
            <button
              type="button"
              className={`manga-btn ${mapMode === "satellite" ? "manga-btn-primary" : "manga-btn-ghost"}`}
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}
              onClick={() => setMapMode("satellite")}
            >
              Satellite
            </button>
          </div>
        </div>

        {/* Map Stage Container */}
        <div style={{ width: "100%", height: "460px", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--line)", position: "relative" }}>
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

      <div className="manga-console">
        <div className="manga-toolbar">
          <h2>Active Reports & Fleet Warnings ({filteredHazards.length})</h2>

          <div className="manga-filter-row">
            <input
              type="text"
              placeholder="🔍 Search location, driver or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
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
          <div style={{ textAlign: "center", padding: "3rem" }} className="manga-hero-note">Loading active hazard reports...</div>
        ) : filteredHazards.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3.5rem 1rem" }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🛡️</div>
            <div className="manga-title" style={{ fontSize: "1.2rem" }}>No Active Police Traps or Hazards</div>
            <p className="manga-lead">
              Click "📍 Drop Pin on Map" or "+ Report Speed Trap" above to pinpoint a hazard.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1rem" }}>
            {filteredHazards.map((h) => {
              const isPolice = h.type === "police_checkpoint" || h.type === "speed_trap";
              const isSelected = selectedHazardId === h.id;

              return (
                <div
                  key={h.id}
                  className="manga-console"
                  style={{
                    marginBottom: 0,
                    cursor: "pointer",
                    outline: isSelected ? "3px solid var(--manga-accent)" : undefined,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                  onClick={() => {
                    setSelectedHazardId(h.id);
                    hazardMapRef.current?.focusHazard(h);
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                      <span className={`manga-chip ${isPolice ? "manga-chip--danger" : ""}`}>
                        {formatHazardType(h.type)}
                      </span>
                      <span className={`manga-chip ${h.confirmedByDispatcher ? "manga-chip--ok" : ""}`}>
                        {h.confirmedByDispatcher ? "✅ Confirmed" : "⚠️ Driver Reported"}
                      </span>
                    </div>

                    <h2 style={{ margin: "0.3rem 0", fontSize: "1.15rem" }}>
                      📍 {h.locationName || "Reported Location"}
                    </h2>

                    {h.notes && (
                      <p className="manga-lead" style={{ margin: "0.5rem 0", fontStyle: "italic", padding: "0.5rem 0.75rem", border: "2px solid #111", borderRadius: "3px" }}>
                        "{h.notes}"
                      </p>
                    )}

                    <div className="manga-hero-note" style={{ marginTop: "0.6rem" }}>
                      Reported by: <strong>{h.driverName}</strong>
                      {h.lat && h.lng ? ` · (${h.lat.toFixed(4)}, ${h.lng.toFixed(4)})` : ""}
                    </div>
                  </div>

                  <div
                    className="manga-filter-row"
                    style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "2px solid #111" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!h.confirmedByDispatcher && (
                      <button
                        type="button"
                        className="manga-btn manga-btn-ok"
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => handleConfirmHazard(h.id)}
                      >
                        ✅ Confirm Accuracy
                      </button>
                    )}
                    <button
                      type="button"
                      className="manga-btn manga-btn-primary"
                      style={{ fontSize: "0.8rem" }}
                      onClick={() => handleBroadcastWarning(h)}
                    >
                      📢 Broadcast Siren
                    </button>
                    <button
                      type="button"
                      className="manga-btn manga-btn-ghost"
                      style={{ fontSize: "0.8rem" }}
                      onClick={() => handleClearHazard(h.id)}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div className="manga-modal-backdrop">
          <div className="manga-modal" style={{ maxWidth: "580px" }}>
            <div className="manga-toolbar" style={{ marginBottom: "0.75rem" }}>
              <h2>Report Police Checkpoint / Speed Trap</h2>
              <button type="button" className="manga-btn manga-btn-ghost" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="manga-banner" style={{ marginBottom: "1.25rem", fontSize: "0.85rem" }}>
              🎯 <strong>Pro Tip:</strong> Click anywhere on the map behind this window to pinpoint exact street coordinates and automatically fill location details!
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
                >
                  <option value="police_checkpoint">👮 Police Checkpoint / Sobriety Station</option>
                  <option value="speed_trap">⚡ Radar Speed Trap / Patrol Gun</option>
                  <option value="road_hazard">⚠️ Road Danger / Construction</option>
                  <option value="accident">💥 Traffic Accident</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Location / Intersection Name</label>
                <input
                  type="text"
                  required
                  placeholder="Click map or enter e.g. Highway 65 & Main St Exit"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1rem" }}>
                <div className="form-group">
                  <label>Latitude</label>
                  <input
                    type="text"
                    placeholder="Auto-filled from map"
                    value={latStr}
                    onChange={(e) => setLatStr(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Longitude</label>
                  <input
                    type="text"
                    placeholder="Auto-filled from map"
                    value={lngStr}
                    onChange={(e) => setLngStr(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label>Notes / Advice for Fleet Drivers</label>
                <input
                  type="text"
                  placeholder="e.g. State Trooper checking speed guns on eastbound lane"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="manga-filter-row" style={{ marginTop: "1.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="manga-btn manga-btn-ghost"
                  onClick={() => {
                    setShowModal(false);
                    setIsPickMode(false);
                    hazardMapRef.current?.setPickMode(false, type);
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="manga-btn manga-btn-danger"
                  disabled={submitting}
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
