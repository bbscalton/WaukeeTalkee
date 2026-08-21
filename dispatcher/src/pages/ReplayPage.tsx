import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import type { FeatureCollection } from "geojson";
import {
  dayBounds,
  formatDayLabel,
  lastSevenDayKeys,
} from "../radio";
import { RADIO_RETENTION_DAYS, type Driver, type TrackPoint } from "../types";

const STREET_STYLE =
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

const SOURCE_ID = "dvr-track";
const LINE_ID = "dvr-line";

function pointMs(p: TrackPoint): number {
  const ts = p.t;
  if (!ts) return 0;
  if ("toMillis" in ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  if ("seconds" in ts) return ts.seconds * 1000;
  return 0;
}

export function ReplayPage() {
  const [search, setSearch] = useSearchParams();
  const dayKeys = useMemo(() => lastSevenDayKeys(), []);
  const day = search.get("day") || dayKeys[0]!;
  const driverParam = search.get("driver");

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const playRef = useRef<number | null>(null);

  const selectedId =
    driverParam && drivers.some((d) => d.id === driverParam)
      ? driverParam
      : drivers.find((d) => d.pairStatus === "paired")?.id ?? null;

  useEffect(() => {
    return onSnapshot(collection(db, "orgs", ORG_ID, "drivers"), (snap) => {
      setDrivers(
        snap.docs.map((d) => {
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
            lastTelemetryAt: data.lastTelemetryAt ?? null,
          };
        })
      );
    });
  }, []);

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
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPoints([]);
      return;
    }
    const { start, end } = dayBounds(day);
    const q = query(
      collection(db, "orgs", ORG_ID, "tracks", selectedId, "points"),
      where("t", ">=", Timestamp.fromDate(start)),
      where("t", "<", Timestamp.fromDate(end)),
      orderBy("t", "asc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setPoints(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              t: (data.t as Timestamp | null) ?? null,
              lat: Number(data.lat),
              lng: Number(data.lng),
              speed: typeof data.speed === "number" ? data.speed : null,
              heading: typeof data.heading === "number" ? data.heading : null,
            };
          })
        );
        setCursor(0);
        setPlaying(false);
        setError(null);
      },
      (err) => setError(err.message)
    );
  }, [selectedId, day]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const coords = points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => [p.lng, p.lat] as [number, number]);

    const geojson: FeatureCollection = {
      type: "FeatureCollection",
      features:
        coords.length >= 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: coords },
              },
            ]
          : [],
    };

    if (map.getSource(SOURCE_ID)) {
      (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(SOURCE_ID, { type: "geojson", data: geojson });
      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#f0b429",
          "line-width": 4,
          "line-opacity": 0.85,
        },
      });
    }

    if (coords.length) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 500 });
    }

    const idx = Math.min(cursor, Math.max(0, points.length - 1));
    const here = points[idx];
    if (here && Number.isFinite(here.lat) && Number.isFinite(here.lng)) {
      if (!markerRef.current) {
        const el = document.createElement("div");
        el.className = "map-marker dvr-marker";
        markerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([here.lng, here.lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([here.lng, here.lat]);
      }
    } else {
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [points, cursor, mapReady]);

  useEffect(() => {
    if (!playing || points.length < 2) {
      if (playRef.current != null) {
        window.clearInterval(playRef.current);
        playRef.current = null;
      }
      return;
    }
    playRef.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= points.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 400);
    return () => {
      if (playRef.current != null) {
        window.clearInterval(playRef.current);
        playRef.current = null;
      }
    };
  }, [playing, points.length]);

  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const paired = drivers.filter((d) => d.pairStatus === "paired");
  const at = points[Math.min(cursor, Math.max(0, points.length - 1))];
  const atLabel = at
    ? new Date(pointMs(at)).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="map-layout replay-layout">
      <aside className="map-side">
        <p className="map-kicker">Map DVR</p>
        <h1>Day replay</h1>
        <p className="muted">
          Scrub a driver’s path for any of the last {RADIO_RETENTION_DAYS} days.
          Oldest day rolls off automatically.
        </p>
        {error && <p className="error">{error}</p>}

        <label>
          Day
          <select
            value={day}
            onChange={(e) => {
              const next = new URLSearchParams(search);
              next.set("day", e.target.value);
              setSearch(next);
            }}
          >
            {dayKeys.map((k) => (
              <option key={k} value={k}>
                {formatDayLabel(k)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Driver
          <select
            value={selectedId ?? ""}
            onChange={(e) => {
              const next = new URLSearchParams(search);
              next.set("driver", e.target.value);
              setSearch(next);
            }}
          >
            {paired.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
        </label>

        <div className="panel dvr-panel">
          <p className="map-kicker">{selected?.displayName ?? "No driver"}</p>
          <p className="muted">
            {points.length} points · {atLabel}
          </p>
          <div className="dvr-controls">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              disabled={points.length < 2}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPlaying(false);
                setCursor(0);
              }}
              disabled={!points.length}
            >
              Reset
            </button>
          </div>
          <label className="dvr-scrub">
            Timeline
            <input
              type="range"
              min={0}
              max={Math.max(0, points.length - 1)}
              value={Math.min(cursor, Math.max(0, points.length - 1))}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
              disabled={points.length < 2}
            />
          </label>
          {!points.length && (
            <p className="muted small">
              No track for this day yet. Driver must be on duty so the phone
              appends GPS breadcrumbs.
            </p>
          )}
        </div>
      </aside>
      <div className="map-stage">
        <div className="map-canvas" ref={mapNode} />
        {!mapReady && <div className="map-loading">Loading map…</div>}
      </div>
    </div>
  );
}
