import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import { formatAge, formatSpeed, type Driver } from "../types";

const STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export function MapPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: STYLE,
      center: [-93.62, 41.58],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
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
      },
      (err) => setError(err.message)
    );
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
  }, [drivers, selectedId]);

  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const onDutyCount = drivers.filter((d) => d.onDuty).length;

  return (
    <div className="map-layout">
      <aside className="map-side">
        <h1>Live map</h1>
        <p className="muted">{onDutyCount} on duty · {drivers.length} total</p>
        {error && <p className="error">{error}</p>}
        <ul className="driver-list">
          {drivers
            .filter((d) => d.onDuty)
            .map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={selectedId === d.id ? "selected" : ""}
                  onClick={() => setSelectedId(d.id)}
                >
                  <strong>{d.displayName}</strong>
                  <span>{formatSpeed(d.lastSpeed)}</span>
                  <span className="muted">{formatAge(d.lastTelemetryAt)}</span>
                </button>
              </li>
            ))}
          {onDutyCount === 0 && (
            <li className="muted">No drivers on duty yet.</li>
          )}
        </ul>
        {selected && (
          <div className="panel detail">
            <h2>{selected.displayName}</h2>
            <p>Speed: {formatSpeed(selected.lastSpeed)}</p>
            <p>
              Position:{" "}
              {selected.lastLat != null && selected.lastLng != null
                ? `${selected.lastLat.toFixed(5)}, ${selected.lastLng.toFixed(5)}`
                : "—"}
            </p>
            <p className="muted">Updated {formatAge(selected.lastTelemetryAt)}</p>
            {!selected.onDuty && <p className="muted">Currently off duty</p>}
          </div>
        )}
      </aside>
      <div className="map-canvas" ref={mapNode} />
    </div>
  );
}
