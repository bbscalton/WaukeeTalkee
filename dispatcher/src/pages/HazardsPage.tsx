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
    <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "var(--ink)" }}>
      {/* Hero Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
              Live Patrol Radar
            </span>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Proximity Alert Radius: <strong>1.5 km (1 mi)</strong>
            </span>
          </div>
          <h1 style={{ margin: "0.4rem 0 0 0", fontSize: "2rem", color: "#fff", fontWeight: 800, letterSpacing: "-0.02em" }}>
            👮 Police Radar Trap & Checkpoint Command
          </h1>
          <p style={{ margin: "0.3rem 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
            Tactical map, pin placement, real-time driver sirens & proximity hazard warnings.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={togglePickMode}
            style={{
              background: isPickMode ? "#f59e0b" : "rgba(245, 158, 11, 0.15)",
              color: isPickMode ? "#000" : "#f59e0b",
              border: "1px solid #f59e0b",
              fontWeight: 800,
              padding: "0.75rem 1.25rem",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              boxShadow: isPickMode ? "0 0 15px rgba(245, 158, 11, 0.4)" : "none",
              transition: "all 0.2s ease"
            }}
          >
            {isPickMode ? "🎯 Map Targeting Mode Active" : "📍 Drop Pin on Map"}
          </button>
          <button
            onClick={() => {
              setShowModal(true);
              setIsPickMode(true);
              hazardMapRef.current?.setPickMode(true, type);
            }}
            style={{
              background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
              color: "#fff",
              border: "none",
              fontWeight: 800,
              padding: "0.75rem 1.25rem",
              borderRadius: "10px",
              boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
              transition: "all 0.2s ease"
            }}
          >
            + Report Speed Trap / Checkpoint
          </button>
        </div>
      </div>

      {/* KPI Counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div style={{ background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#ef4444", fontWeight: 700 }}>Active Police & Radar Traps</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{policeCount}</div>
        </div>
        <div style={{ background: unconfirmedCount > 0 ? "rgba(245, 158, 11, 0.12)" : "rgba(255, 255, 255, 0.03)", border: unconfirmedCount > 0 ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: unconfirmedCount > 0 ? "#f59e0b" : "var(--muted)", fontWeight: 700 }}>Awaiting Verification</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{unconfirmedCount}</div>
        </div>
        <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 700 }}>Total Active Hazards</div>
          <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#fff", marginTop: "0.2rem" }}>{activeHazards.length}</div>
        </div>
        <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 700 }}>Automatic Driver Siren</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#22c55e", marginTop: "0.4rem" }}>ENABLED 🔊</div>
        </div>
      </div>

      {/* Main Tactical Map Hero Card */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1rem", marginBottom: "1.5rem", position: "relative" }}>
        
        {/* Map Top Action Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              🗺️ Tactical Map Pinpoint Console
            </span>
            {isPickMode && (
              <span style={{ background: "#f59e0b", color: "#000", padding: "0.25rem 0.75rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 900, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                🎯 CLICK MAP TO LOCK HAZARD LOCATION
              </span>
            )}
          </div>

          {/* Quick Preset Pin Buttons on Map Header */}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Quick Pin:</span>
            <button
              onClick={() => startQuickPinDrop("police_checkpoint")}
              style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.4)", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}
            >
              👮 Police
            </button>
            <button
              onClick={() => startQuickPinDrop("speed_trap")}
              style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}
            >
              ⚡ Radar Trap
            </button>
            <button
              onClick={() => startQuickPinDrop("road_hazard")}
              style={{ background: "rgba(234,179,8,0.2)", color: "#eab308", border: "1px solid rgba(234,179,8,0.4)", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}
            >
              ⚠️ Road Danger
            </button>

            <div style={{ width: "1px", height: "20px", background: "var(--line)", margin: "0 0.2rem" }} />

            <button
              onClick={() => setMapMode("streets")}
              style={{ background: mapMode === "streets" ? "var(--amber)" : "rgba(255,255,255,0.05)", color: mapMode === "streets" ? "#000" : "#fff", border: "1px solid var(--line)", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}
            >
              Streets
            </button>
            <button
              onClick={() => setMapMode("satellite")}
              style={{ background: mapMode === "satellite" ? "var(--amber)" : "rgba(255,255,255,0.05)", color: mapMode === "satellite" ? "#000" : "#fff", border: "1px solid var(--line)", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}
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

      {/* Reports Section with Filter Tabs */}
      <div style={{ background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.25rem" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 800 }}>
            Active Reports & Fleet Warnings ({filteredHazards.length})
          </h2>

          {/* Search Bar & Filter Options */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="🔍 Search location, driver or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "1px solid var(--line)",
                fontSize: "0.85rem",
                minWidth: "240px"
              }}
            />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{
                padding: "0.55rem 0.9rem",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
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

        {/* Hazard Cards Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>Loading active hazard reports...</div>
        ) : filteredHazards.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3.5rem 1rem", color: "var(--muted)" }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🛡️</div>
            <div style={{ fontWeight: 700, fontSize: "1.2rem", color: "#fff" }}>No Active Police Traps or Hazards</div>
            <p style={{ margin: "0.4rem 0 0 0", fontSize: "0.9rem" }}>
              Click "📍 Drop Pin on Map" or "+ Report Speed Trap" above to pinpoint a hazard.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1rem" }}>
            {filteredHazards.map((h) => {
              const isPolice = h.type === "police_checkpoint" || h.type === "speed_trap";
              const cardBorder = isPolice ? "#ef4444" : "#f59e0b";
              const isSelected = selectedHazardId === h.id;

              return (
                <div
                  key={h.id}
                  onClick={() => {
                    setSelectedHazardId(h.id);
                    hazardMapRef.current?.focusHazard(h);
                  }}
                  style={{
                    background: isSelected ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.025)",
                    borderLeft: `4px solid ${cardBorder}`,
                    borderTop: isSelected ? `1px solid ${cardBorder}` : "1px solid var(--line)",
                    borderRight: isSelected ? `1px solid ${cardBorder}` : "1px solid var(--line)",
                    borderBottom: isSelected ? `1px solid ${cardBorder}` : "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "1.1rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                      <span style={{
                        padding: "0.25rem 0.65rem",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        fontWeight: 800,
                        background: isPolice ? "rgba(239, 68, 68, 0.2)" : "rgba(245, 158, 11, 0.2)",
                        color: isPolice ? "#ef4444" : "#f59e0b",
                        border: `1px solid ${isPolice ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`
                      }}>
                        {formatHazardType(h.type)}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: h.confirmedByDispatcher ? "#22c55e" : "#f59e0b", fontWeight: 800 }}>
                        {h.confirmedByDispatcher ? "✅ Confirmed" : "⚠️ Driver Reported"}
                      </span>
                    </div>

                    <h3 style={{ margin: "0.3rem 0", color: "#fff", fontSize: "1.15rem", fontWeight: 800 }}>
                      📍 {h.locationName || "Reported Location"}
                    </h3>

                    {h.notes && (
                      <p style={{ margin: "0.5rem 0", color: "#e2e8f0", fontSize: "0.85rem", fontStyle: "italic", background: "rgba(0,0,0,0.25)", padding: "0.5rem 0.75rem", borderRadius: "8px", borderLeft: `2px solid ${cardBorder}` }}>
                        "{h.notes}"
                      </p>
                    )}

                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.6rem" }}>
                      Reported by: <strong style={{ color: "#cbd5e1" }}>{h.driverName}</strong>
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
                        style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: "6px", padding: "0.45rem 0.8rem", fontSize: "0.8rem", cursor: "pointer", fontWeight: 800 }}
                      >
                        ✅ Confirm Accuracy
                      </button>
                    )}
                    <button
                      onClick={() => handleBroadcastWarning(h)}
                      style={{ background: "#f59e0b", color: "#000", border: "none", borderRadius: "6px", padding: "0.45rem 0.8rem", fontSize: "0.8rem", cursor: "pointer", fontWeight: 900 }}
                    >
                      📢 Broadcast Siren
                    </button>
                    <button
                      onClick={() => handleClearHazard(h.id)}
                      style={{ background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "1px solid var(--line)", borderRadius: "6px", padding: "0.45rem 0.75rem", fontSize: "0.8rem", cursor: "pointer" }}
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

      {/* Create Hazard Modal */}
      {showModal && (
        <div className="modal" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: "580px", width: "92%", background: "#0f172a", border: "1px solid var(--line)", borderRadius: "16px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "#fff", fontSize: "1.3rem", fontWeight: 800 }}>Report Police Checkpoint / Speed Trap</h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ background: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.4)", padding: "0.75rem 1rem", borderRadius: "10px", marginBottom: "1.25rem", fontSize: "0.85rem", color: "#f59e0b", fontWeight: 600 }}>
              🎯 <strong>Pro Tip:</strong> Click anywhere on the map behind this window to pinpoint exact street coordinates and automatically fill location details!
            </div>

            <form onSubmit={handleCreateHazard}>
              <div className="form-group">
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Hazard Type</label>
                <select
                  value={type}
                  onChange={(e) => {
                    const newType = e.target.value as HazardType;
                    setType(newType);
                    hazardMapRef.current?.setPickMode(true, newType);
                  }}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                >
                  <option value="police_checkpoint">👮 Police Checkpoint / Sobriety Station</option>
                  <option value="speed_trap">⚡ Radar Speed Trap / Patrol Gun</option>
                  <option value="road_hazard">⚠️ Road Danger / Construction</option>
                  <option value="accident">💥 Traffic Accident</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Location / Intersection Name</label>
                <input
                  type="text"
                  required
                  placeholder="Click map or enter e.g. Highway 65 & Main St Exit"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1rem" }}>
                <div className="form-group">
                  <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Latitude</label>
                  <input
                    type="text"
                    placeholder="Auto-filled from map"
                    value={latStr}
                    onChange={(e) => setLatStr(e.target.value)}
                    style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Longitude</label>
                  <input
                    type="text"
                    placeholder="Auto-filled from map"
                    value={lngStr}
                    onChange={(e) => setLngStr(e.target.value)}
                    style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ color: "#cbd5e1", fontWeight: 700, fontSize: "0.85rem" }}>Notes / Advice for Fleet Drivers</label>
                <input
                  type="text"
                  placeholder="e.g. State Trooper checking speed guns on eastbound lane"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", background: "#1e293b", color: "#fff", border: "1px solid var(--line)", marginTop: "0.4rem" }}
                />
              </div>

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setIsPickMode(false);
                    hazardMapRef.current?.setPickMode(false, type);
                  }}
                  style={{ background: "rgba(255,255,255,0.08)", color: "#cbd5e1", border: "1px solid var(--line)", padding: "0.7rem 1.25rem", borderRadius: "10px", fontWeight: 700 }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)", color: "#fff", border: "none", padding: "0.7rem 1.4rem", borderRadius: "10px", fontWeight: 800, boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)" }}
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
