import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  hasGoogleMapsApiKey,
  loadMapsLibrary,
  MAP_UI_OPTIONS,
  markerIcon,
} from "../googleMaps";
import {
  dayBounds,
  formatDayLabel,
  lastSevenDayKeys,
} from "../radio";
import { RADIO_RETENTION_DAYS, type Driver, type TrackPoint } from "../types";

type MapMode = "streets" | "satellite";

function pointMs(p: TrackPoint): number {
  const ts = p.t;
  if (!ts) return 0;
  if ("toMillis" in ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  if ("seconds" in ts) return ts.seconds * 1000;
  return 0;
}

function mapTypeForMode(mode: MapMode): string {
  return mode === "satellite" ? "hybrid" : "roadmap";
}

export function ReplayPage() {
  const [search, setSearch] = useSearchParams();
  const dayKeys = useMemo(() => lastSevenDayKeys(), []);
  const day = search.get("day") || dayKeys[0]!;
  const driverParam = search.get("driver");

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const pathRef = useRef<google.maps.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("satellite");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const playRef = useRef<number | null>(null);
  const lastFitKey = useRef<string | null>(null);

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
    if (!hasGoogleMapsApiKey()) {
      setError(
        "Google Maps API key missing. Set VITE_GOOGLE_MAPS_API_KEY in dispatcher/.env."
      );
      return;
    }

    let cancelled = false;
    const container = mapNode.current;

    (async () => {
      try {
        const { Map } = await loadMapsLibrary();
        if (cancelled || !container) return;
        const map = new Map(container, {
          ...MAP_UI_OPTIONS,
          streetViewControl: false,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: mapTypeForMode("satellite"),
        });
        mapRef.current = map;
        pathRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: "#f0b429",
          strokeOpacity: 0.85,
          strokeWeight: 4,
        });
        google.maps.event.addListenerOnce(map, "idle", () => {
          if (!cancelled) setMapReady(true);
        });
        google.maps.event.trigger(map, "resize");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Google Maps");
        }
      }
    })();

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      pathRef.current?.setMap(null);
      pathRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(mapTypeForMode(mapMode));
  }, [mapMode]);

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
        lastFitKey.current = null;
      },
      (err) => setError(err.message)
    );
  }, [selectedId, day]);

  useEffect(() => {
    const map = mapRef.current;
    const path = pathRef.current;
    if (!map || !path || !mapReady) return;

    const coords = points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ lat: p.lat, lng: p.lng }));

    path.setPath(coords);

    const fitKey = `${selectedId ?? ""}:${day}:${coords.length}`;
    if (coords.length && fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      const bounds = new google.maps.LatLngBounds();
      for (const c of coords) bounds.extend(c);
      map.fitBounds(bounds, 56);
      const z = map.getZoom();
      if (z != null && z > 15) map.setZoom(15);
    }

    const idx = Math.min(cursor, Math.max(0, points.length - 1));
    const here = points[idx];
    if (here && Number.isFinite(here.lat) && Number.isFinite(here.lng)) {
      const position = { lat: here.lat, lng: here.lng };
      if (!markerRef.current) {
        markerRef.current = new google.maps.Marker({
          map,
          position,
          icon: markerIcon("#f0b429", true),
          zIndex: 5,
        });
      } else {
        markerRef.current.setPosition(position);
      }
    } else {
      markerRef.current?.setMap(null);
      markerRef.current = null;
    }
  }, [points, cursor, mapReady, selectedId, day]);

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
        {!mapReady && !error && <div className="map-loading">Loading map…</div>}
      </div>
    </div>
  );
}
