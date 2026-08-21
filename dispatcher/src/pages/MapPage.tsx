import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import { PushToTalk } from "../components/PushToTalk";
import { formatAge, formatSpeed, type Driver } from "../types";

const STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export function MapPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: STYLE,
      center: [-93.62, 41.58],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.resize();
      setMapReady(true);
    });
    mapRef.current = map;

    const onWinResize = () => map.resize();
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(db, "orgs", ORG_ID, "drivers"),
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
            lastLat: typeof data.lastLat === "number" ? data.lastLat : null,
            lastLng: typeof data.lastLng === "number" ? data.lastLng : null,
            lastSpeed: typeof data.lastSpeed === "number" ? data.lastSpeed : null,
            lastHeading:
              typeof data.lastHeading === "number" ? data.lastHeading : null,
            lastTelemetryAt: (data.lastTelemetryAt as Timestamp | null) ?? null,
          };
        });
        setDrivers(rows);
        setSelectedId((prev) => {
          if (prev && rows.some((r) => r.id === prev)) return prev;
          const first = rows.find((r) => r.pairStatus === "paired");
          return first?.id ?? null;
        });
      },
      (err) => setError(err.message)
    );
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const active = drivers.filter(
      (d) => d.onDuty && d.lastLat != null && d.lastLng != null
    );
    const seen = new Set<string>();

    for (const d of active) {
      seen.add(d.id);
      const lng = d.lastLng!;
      const lat = d.lastLat!;
      let marker = markersRef.current.get(d.id);
      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-marker";
        el.title = d.displayName;
        el.addEventListener("click", () => setSelectedId(d.id));
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.set(d.id, marker);
      } else {
        marker.setLngLat([lng, lat]);
        const el = marker.getElement();
        el.classList.toggle("selected", selectedId === d.id);
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    if (active.length === 1) {
      map.easeTo({ center: [active[0]!.lastLng!, active[0]!.lastLat!], zoom: 13 });
    } else if (active.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      active.forEach((d) => bounds.extend([d.lastLng!, d.lastLat!]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }

    map.resize();
  }, [drivers, selectedId, mapReady]);

  const paired = drivers.filter((d) => d.pairStatus === "paired");
  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const onDutyCount = drivers.filter((d) => d.onDuty).length;

  return (
    <div className="map-layout">
      <aside className="map-side">
        <p className="map-kicker">Fleet radio</p>
        <h1>Talk to drivers</h1>
        <p className="muted">
          {onDutyCount} on duty · {paired.length} paired
        </p>
        {error && <p className="error">{error}</p>}

        {selected ? (
          <div className="panel detail radio-panel">
            <p className="map-kicker">Channel open</p>
            <h2>{selected.displayName}</h2>
            <div className="detail-meta">
              <span>{selected.onDuty ? "On duty" : "Off duty"}</span>
              <span>Speed: {formatSpeed(selected.lastSpeed)}</span>
              <span>Updated {formatAge(selected.lastTelemetryAt)}</span>
            </div>
            <PushToTalk driverId={selected.id} driverName={selected.displayName} />
          </div>
        ) : (
          <div className="panel detail">
            <p className="muted">
              No paired driver yet. Open Drivers, create a pair code, connect the
              phone.
            </p>
          </div>
        )}

        <p className="list-label">Units</p>
        <ul className="driver-list">
          {paired.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={selectedId === d.id ? "selected" : ""}
                onClick={() => setSelectedId(d.id)}
              >
                <strong>{d.displayName}</strong>
                <span>{d.onDuty ? formatSpeed(d.lastSpeed) : "Off duty"}</span>
                <span className="talk-hint">
                  {selectedId === d.id ? "Radio open ↓" : "Tap to talk"}
                </span>
              </button>
            </li>
          ))}
          {paired.length === 0 && (
            <li className="muted">No paired drivers yet.</li>
          )}
        </ul>
      </aside>
      <div className="map-stage">
        <div className="map-canvas" ref={mapNode} />
        {!mapReady && <div className="map-loading">Loading map…</div>}
      </div>
    </div>
  );
}
