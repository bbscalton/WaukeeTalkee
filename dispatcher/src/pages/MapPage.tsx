import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import { PushToTalk } from "../components/PushToTalk";
import { formatAge, formatSpeed, type Driver } from "../types";

type MapMode = "streets" | "satellite";

const STREET_STYLE =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "esri-satellite",
      type: "raster",
      source: "esri",
    },
  ],
};

function hasFix(d: Driver): boolean {
  return (
    d.lastLat != null &&
    d.lastLng != null &&
    Number.isFinite(d.lastLat) &&
    Number.isFinite(d.lastLng) &&
    !(d.lastLat === 0 && d.lastLng === 0)
  );
}

function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

export function MapPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("streets");

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: STREET_STYLE,
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

  const mapModeInit = useRef(true);
  useEffect(() => {
    if (mapModeInit.current) {
      mapModeInit.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    setMapReady(false);
    const style = mapMode === "satellite" ? SATELLITE_STYLE : STREET_STYLE;
    map.setStyle(style);
    map.once("style.load", () => {
      map.resize();
      setMapReady(true);
    });
  }, [mapMode]);

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

  const lastFlyRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Show any paired (or on-duty) driver that has a GPS fix — not only on-duty.
    const located = drivers.filter(
      (d) => (d.pairStatus === "paired" || d.onDuty) && hasFix(d)
    );
    const seen = new Set<string>();

    for (const d of located) {
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
      }
      const el = marker.getElement();
      el.classList.toggle("selected", selectedId === d.id);
      el.classList.toggle("off-duty", !d.onDuty);
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    const focus = located.find((d) => d.id === selectedId) ?? located[0];
    const flyKey = focus ? `${focus.id}:${selectedId ?? ""}` : null;
    if (focus && flyKey !== lastFlyRef.current) {
      lastFlyRef.current = flyKey;
      map.easeTo({
        center: [focus.lastLng!, focus.lastLat!],
        zoom: Math.max(map.getZoom(), 14),
        duration: 600,
      });
    }

    map.resize();
  }, [drivers, selectedId, mapReady]);

  const paired = drivers.filter((d) => d.pairStatus === "paired");
  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const onDutyCount = drivers.filter((d) => d.onDuty).length;
  const selectedHasFix = selected ? hasFix(selected) : false;

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
              {selectedHasFix ? (
                <span>
                  GPS: {selected.lastLat!.toFixed(5)}, {selected.lastLng!.toFixed(5)}
                </span>
              ) : (
                <span className="error">
                  No map pin yet — on the phone tap On Duty and allow location.
                </span>
              )}
            </div>
            {selectedHasFix && (
              <a
                className="street-link"
                href={streetViewUrl(selected.lastLat!, selected.lastLng!)}
                target="_blank"
                rel="noreferrer"
              >
                Open Street View here
              </a>
            )}
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
                <span>
                  {d.onDuty ? formatSpeed(d.lastSpeed) : "Off duty"}
                  {hasFix(d) ? "" : " · no GPS"}
                </span>
                <span className="talk-hint">
                  {selectedId === d.id ? "Radio open" : "Tap to talk"}
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
        <div className="map-modes" role="group" aria-label="Map style">
          <button
            type="button"
            className={mapMode === "streets" ? "active" : ""}
            onClick={() => setMapMode("streets")}
          >
            Streets
          </button>
          <button
            type="button"
            className={mapMode === "satellite" ? "active" : ""}
            onClick={() => setMapMode("satellite")}
          >
            Satellite
          </button>
        </div>
        <div className="map-canvas" ref={mapNode} />
        {!mapReady && <div className="map-loading">Loading map…</div>}
      </div>
    </div>
  );
}
