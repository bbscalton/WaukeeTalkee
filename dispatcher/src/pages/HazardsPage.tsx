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
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  hasGoogleMapsApiKey,
  loadMapsLibrary,
  MAP_UI_OPTIONS
} from "../googleMaps";

export const HazardsPage: React.FC = () => {
  const { user } = useAuth();
  const [hazards, setHazards] = useState<HazardAlert[]>([]);
  const [loading, setLoading] = useState(true);

  // Map state
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<"streets" | "satellite">("satellite");
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);

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

  // Initialize Google Map
  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;
    if (!hasGoogleMapsApiKey()) return;

    let cancelled = false;
    (async () => {
      try {
        const { Map, InfoWindow } = await loadMapsLibrary();
        if (cancelled || !mapNodeRef.current) return;

        const map = new Map(mapNodeRef.current, {
          ...MAP_UI_OPTIONS,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: mapMode === "satellite" ? "hybrid" : "roadmap",
        });

        mapRef.current = map;
        infoWindowRef.current = new InfoWindow();

        google.maps.event.addListenerOnce(map, "idle", () => {
          if (!cancelled) setMapReady(true);
        });
      } catch (err) {
        console.error("Failed to load map on HazardsPage:", err);
      }
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setMapTypeId(mapMode === "satellite" ? "hybrid" : "roadmap");
    }
  }, [mapMode]);

  // Sync Markers with Active Hazards
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const activeList = hazards.filter((h) => h.status === "active");
    const seen = new Set<string>();

    for (const h of activeList) {
      if (typeof h.lat !== "number" || typeof h.lng !== "number" || (h.lat === 0 && h.lng === 0)) {
        continue;
      }

      seen.add(h.id);
      const position = { lat: h.lat, lng: h.lng };
      const isPolice = h.type === "police_checkpoint" || h.type === "speed_trap";
      const fillColor = isPolice ? "#ff4d4d" : "#f1c40f";

      let marker = markersRef.current.get(h.id);
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position,
          title: `${formatHazardType(h.type)}: ${h.locationName}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: fillColor,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });

        marker.addListener("click", () => {
          setSelectedHazardId(h.id);
          showInfoWindow(h, marker!);
        });

        markersRef.current.set(h.id, marker);
      } else {
        marker.setPosition(position);
      }
    }

    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });

    if (activeList.length > 0 && mapReady) {
      const firstValid = activeList.find((h) => h.lat && h.lng && (h.lat !== 0 || h.lng !== 0));
      if (firstValid && !selectedHazardId) {
        map.panTo({ lat: firstValid.lat, lng: firstValid.lng });
      }
    }
  }, [hazards, mapReady]);

  const showInfoWindow = (h: HazardAlert, marker: google.maps.Marker) => {
    if (!infoWindowRef.current || !mapRef.current) return;

    const isConfirmed = h.confirmedByDispatcher;
    const contentString = `
      <div style="color: #111; font-family: system-ui, sans-serif; padding: 4px; max-width: 260px;">
        <div style="font-weight: 800; font-size: 14px; margin-bottom: 4px; color: ${h.type === 'police_checkpoint' ? '#d9534f' : '#f0ad4e'}">
          ${formatHazardType(h.type)}
        </div>
        <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">
          📍 ${h.locationName || 'Reported Location'}
        </div>
        <div style="font-size: 12px; color: #555; margin-bottom: 6px;">
          Reported by: <strong>${h.driverName}</strong><br/>
          Status: <strong>${isConfirmed ? '✅ Confirmed Accurate' : '⚠️ Driver Reported'}</strong>
        </div>
        ${h.notes ? `<div style="font-size: 11px; font-style: italic; background: #f8f9fa; padding: 4px 6px; border-radius: 4px; margin-bottom: 8px;">"${h.notes}"</div>` : ''}
      </div>
    `;

    infoWindowRef.current.setContent(contentString);
    infoWindowRef.current.open(mapRef.current, marker);
  };

  const focusHazardOnMap = (h: HazardAlert) => {
    setSelectedHazardId(h.id);
    if (!mapRef.current || !h.lat || !h.lng) return;
    mapRef.current.panTo({ lat: h.lat, lng: h.lng });
    mapRef.current.setZoom(15);

    const marker = markersRef.current.get(h.id);
    if (marker) {
      showInfoWindow(h, marker);
    }
  };

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
      alert("Hazard report confirmed! Approaching drivers will now receive proximity warnings.");
    } catch (err: any) {
      alert("Failed to confirm hazard: " + err.message);
    }
  };

  const handleBroadcastWarning = async (hazard: HazardAlert) => {
    if (!ORG_ID) return;
    const text = broadcastMsg || `CAUTION: ${formatHazardType(hazard.type)} reported near ${hazard.locationName || 'your area'}. Maintain speed limit!`;
    if (!confirm(`Broadcast police siren warning to all active drivers?\n\n"${text}"`)) return;

    try {
      await addDoc(collection(db, "orgs", ORG_ID, "broadcasts"), {
        senderName: "Dispatch Patrol Alert",
        message: text,
        severity: "warning",
        createdAt: serverTimestamp(),
      });
      alert("Police warning siren & broadcast message sent to all driver devices!");
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

      {/* Live Interactive Hazard Map */}
      <div className="tcd-card full-width" style={{ marginBottom: "1.5rem", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            🗺️ Live Hazard & Police Checkpoint Map
          </h2>
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
        <div
          ref={mapNodeRef}
          style={{
            width: "100%",
            height: "380px",
            borderRadius: "10px",
            background: "#222",
            border: "1px solid var(--line)"
          }}
        />
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
                  onClick={() => focusHazardOnMap(h)}
                  style={{
                    background: selectedHazardId === h.id ? "rgba(255, 107, 107, 0.1)" : "rgba(255, 255, 255, 0.03)",
                    border: selectedHazardId === h.id ? "2px solid #ff6b6b" : h.type === "police_checkpoint" ? "1px solid #ff6b6b" : "1px solid var(--amber)",
                    borderRadius: "10px",
                    padding: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    cursor: "pointer"
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
                      <span style={{ fontSize: "0.75rem", color: h.confirmedByDispatcher ? "#4caf50" : "var(--amber)", fontWeight: 700 }}>
                        {h.confirmedByDispatcher ? "✅ Confirmed Accurate" : "⚠️ Driver Reported"}
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
                      📢 Broadcast Warning Siren
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
