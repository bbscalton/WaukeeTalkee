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
import { detectStops, type DetectedStop } from "../geo";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  hasGoogleMapsApiKey,
  loadMapsLibrary,
  MAP_LOAD_TIMEOUT_MESSAGE,
  MAP_UI_OPTIONS,
  markerIcon,
  onGoogleMapsAuthFailure,
} from "../googleMaps";
import {
  clipTimeMs,
  dayBounds,
  formatDayLabel,
  lastSevenDayKeys,
  parseRadioClip,
} from "../radio";
import { clearMapDvrAll, clearMapDvrDay } from "../tracks";
import {
  formatDwellMs,
  RADIO_RETENTION_DAYS,
  type Driver,
  type RadioClip,
  type TrackPoint,
} from "../types";

type MapMode = "streets" | "satellite";

type RadioPin = {
  clip: RadioClip;
  lat: number;
  lng: number;
  pointIndex: number;
};

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

function mapPoints(
  docs: { id: string; data: () => Record<string, unknown> }[]
): TrackPoint[] {
  return docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      t: (data.t as Timestamp | null) ?? null,
      lat: Number(data.lat),
      lng: Number(data.lng),
      speed: typeof data.speed === "number" ? data.speed : null,
      heading: typeof data.heading === "number" ? data.heading : null,
    };
  });
}

function nearestPointIndex(points: TrackPoint[], atMs: number): number {
  if (!points.length) return -1;
  let best = 0;
  let bestDiff = Math.abs(pointMs(points[0]!) - atMs);
  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(pointMs(points[i]!) - atMs);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}

export function ReplayPage() {
  const [search, setSearch] = useSearchParams();
  const [dayClock, setDayClock] = useState(() => Date.now());
  const dayKeys = useMemo(
    () => lastSevenDayKeys(new Date(dayClock)),
    [dayClock]
  );
  const day = search.get("day") || dayKeys[0]!;
  const driverParam = search.get("driver");

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const pathRef = useRef<google.maps.Polyline | null>(null);
  const stopMarkersRef = useRef<google.maps.Marker[]>([]);
  const radioMarkersRef = useRef<google.maps.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("satellite");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [dayClips, setDayClips] = useState<RadioClip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [clearing, setClearing] = useState<"day" | "all" | null>(null);
  const [showStops, setShowStops] = useState(true);
  const [showRadio, setShowRadio] = useState(true);
  const playRef = useRef<number | null>(null);
  const lastFitKey = useRef<string | null>(null);
  const playingRef = useRef(false);
  const cursorRef = useRef(0);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    const id = window.setInterval(() => setDayClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
            speedLimitKmh:
              typeof data.speedLimitKmh === "number"
                ? data.speedLimitKmh
                : null,
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
    let mapCreated = false;
    const container = mapNode.current;
    const unsubAuth = onGoogleMapsAuthFailure((message) => {
      if (!cancelled) setError(message);
    });
    const loadTimer = window.setTimeout(() => {
      if (!cancelled && !mapCreated) {
        setError(MAP_LOAD_TIMEOUT_MESSAGE);
      }
    }, 15000);

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
        mapCreated = true;
        window.clearTimeout(loadTimer);
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
        window.clearTimeout(loadTimer);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load Google Maps"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
      unsubAuth();
      markerRef.current?.setMap(null);
      markerRef.current = null;
      pathRef.current?.setMap(null);
      pathRef.current = null;
      for (const m of stopMarkersRef.current) m.setMap(null);
      stopMarkersRef.current = [];
      for (const m of radioMarkersRef.current) m.setMap(null);
      radioMarkersRef.current = [];
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
      setCursor(0);
      setPlaying(false);
      return;
    }

    setCursor(0);
    setPlaying(false);
    lastFitKey.current = null;

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
        const next = mapPoints(snap.docs);
        setPoints(next);
        setCursor(() => {
          if (!next.length) return 0;
          const keep = playingRef.current || cursorRef.current > 0;
          if (!keep) return 0;
          return Math.min(cursorRef.current, next.length - 1);
        });
        setError((prev) =>
          prev && /Google Maps|VITE_GOOGLE_MAPS|authorization failed/i.test(prev)
            ? prev
            : null
        );
      },
      (err) => setError(err.message)
    );
  }, [selectedId, day]);

  useEffect(() => {
    if (!selectedId) {
      setDayClips([]);
      return;
    }
    const { start, end } = dayBounds(day);
    const q = query(
      collection(db, "orgs", ORG_ID, "radio"),
      where("driverId", "==", selectedId),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "asc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setDayClips(
          snap.docs.map((d) =>
            parseRadioClip(d.id, d.data() as Record<string, unknown>)
          )
        );
      },
      () => setDayClips([])
    );
  }, [selectedId, day]);

  const stops: DetectedStop[] = useMemo(() => {
    const timed = points.map((p, i) => ({
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      tMs: pointMs(p) || i,
      _i: i,
    }));
    const raw = detectStops(timed);
    return raw.map((s) => ({
      ...s,
      pointIndex: timed[s.pointIndex]?._i ?? s.pointIndex,
    }));
  }, [points]);

  const radioPins: RadioPin[] = useMemo(() => {
    const pins: RadioPin[] = [];
    for (const clip of dayClips) {
      const at = clipTimeMs(clip);
      if (!at) continue;
      let lat = clip.lat;
      let lng = clip.lng;
      let pointIndex = -1;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        pointIndex = nearestPointIndex(points, at);
        if (pointIndex < 0) continue;
        const p = points[pointIndex]!;
        lat = p.lat;
        lng = p.lng;
      } else {
        pointIndex = nearestPointIndex(points, at);
      }
      pins.push({ clip, lat, lng, pointIndex: Math.max(0, pointIndex) });
    }
    return pins;
  }, [dayClips, points]);

  useEffect(() => {
    const map = mapRef.current;
    const path = pathRef.current;
    if (!map || !path || !mapReady) return;

    const coords = points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => ({ lat: p.lat, lng: p.lng }));

    path.setPath(coords);

    const fitKey = `${selectedId ?? ""}:${day}:${coords.length > 0 ? "has" : "empty"}`;
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
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of stopMarkersRef.current) m.setMap(null);
    stopMarkersRef.current = [];
    if (!showStops) return;
    for (const s of stops) {
      const m = new google.maps.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        icon: markerIcon("#8a93a0", false),
        title: `Stop ${formatDwellMs(s.durationMs)}`,
        zIndex: 3,
      });
      m.addListener("click", () => {
        setPlaying(false);
        setCursor(s.pointIndex);
      });
      stopMarkersRef.current.push(m);
    }
  }, [stops, showStops, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const m of radioMarkersRef.current) m.setMap(null);
    radioMarkersRef.current = [];
    if (!showRadio) return;
    for (const pin of radioPins) {
      const fromDriver = pin.clip.from === "driver";
      const m = new google.maps.Marker({
        map,
        position: { lat: pin.lat, lng: pin.lng },
        icon: markerIcon(fromDriver ? "#3dd68c" : "#5b8cff", false),
        title: fromDriver ? "Driver TX" : "Dispatch TX",
        zIndex: 4,
      });
      m.addListener("click", () => {
        setPlaying(false);
        if (pin.pointIndex >= 0) setCursor(pin.pointIndex);
      });
      radioMarkersRef.current.push(m);
    }
  }, [radioPins, showRadio, mapReady]);

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
  const canPlay = points.length >= 2;
  const at = points[Math.min(cursor, Math.max(0, points.length - 1))];
  const atLabel = at
    ? new Date(pointMs(at)).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
  const dayLabel = formatDayLabel(dayKeys.includes(day) ? day : dayKeys[0]!);

  const clearThisDay = async () => {
    if (!selectedId || !selected) return;
    if (
      !window.confirm(
        `Delete all Map DVR points for ${selected.displayName} on ${dayLabel}? This cannot be undone.`
      )
    ) {
      return;
    }
    setClearing("day");
    setPlaying(false);
    try {
      await clearMapDvrDay(selectedId, day);
      setCursor(0);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not clear this day's tracks."
      );
    } finally {
      setClearing(null);
    }
  };

  const clearAllDvr = async () => {
    if (
      !window.confirm(
        "Delete ALL Map DVR track history for every driver in this org? This cannot be undone."
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        "Final confirmation: clear the entire Map DVR for this organization?"
      )
    ) {
      return;
    }
    setClearing("all");
    setPlaying(false);
    try {
      await clearMapDvrAll();
      setCursor(0);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not clear Map DVR."
      );
    } finally {
      setClearing(null);
    }
  };

  let emptyHint: string | null = null;
  if (!paired.length) {
    emptyHint = "No paired drivers yet. Pair a phone from Contacts first.";
  } else if (!selectedId) {
    emptyHint = "Select a driver to load today’s track.";
  } else if (!points.length) {
    emptyHint =
      "No track points for this day — driver must be On Duty (app 0.5.1+) so the phone records GPS breadcrumbs.";
  } else if (points.length === 1) {
    emptyHint =
      "Only 1 point so far — keep driving on duty until at least 2 points land, then Play unlocks.";
  }

  return (
    <div className="map-layout replay-layout">
      <aside className="map-side">
        <p className="map-kicker">Map DVR</p>
        <h1>Day replay</h1>
        <p className="muted">
          Scrub a driver’s path for any of the last {RADIO_RETENTION_DAYS} days
          (browser local calendar day). Stops and radio pins overlay the track.
        </p>
        {error && <p className="error">{error}</p>}

        <label>
          Day
          <select
            value={dayKeys.includes(day) ? day : dayKeys[0]!}
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
            disabled={!paired.length}
          >
            {!paired.length && <option value="">No paired drivers</option>}
            {paired.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
                {d.onDuty ? " · on duty" : ""}
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
              disabled={!canPlay}
              title={
                canPlay
                  ? undefined
                  : "Need at least 2 track points to play back"
              }
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
              disabled={!canPlay}
            />
          </label>
          <div className="dvr-overlay-toggles">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showStops}
                onChange={(e) => setShowStops(e.target.checked)}
              />
              Stops ({stops.length})
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showRadio}
                onChange={(e) => setShowRadio(e.target.checked)}
              />
              Radio ({radioPins.length})
            </label>
          </div>
          {emptyHint && <p className="muted small">{emptyHint}</p>}
        </div>

        {showStops && stops.length > 0 && (
          <div className="panel dvr-panel">
            <p className="map-kicker">Stops</p>
            <ul className="geofence-list">
              {stops.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="ghost dvr-jump"
                    onClick={() => {
                      setPlaying(false);
                      setCursor(s.pointIndex);
                    }}
                  >
                    {new Date(s.startMs).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {formatDwellMs(s.durationMs)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showRadio && radioPins.length > 0 && (
          <div className="panel dvr-panel">
            <p className="map-kicker">Radio on path</p>
            <ul className="geofence-list">
              {radioPins.map((pin) => (
                <li key={pin.clip.id}>
                  <button
                    type="button"
                    className="ghost dvr-jump"
                    onClick={() => {
                      setPlaying(false);
                      if (pin.pointIndex >= 0) setCursor(pin.pointIndex);
                    }}
                  >
                    <span
                      className={
                        pin.clip.from === "driver"
                          ? "dvr-radio-driver"
                          : "dvr-radio-dispatch"
                      }
                    >
                      {pin.clip.from === "driver" ? "Driver" : "Dispatch"}
                    </span>{" "}
                    {new Date(clipTimeMs(pin.clip)).toLocaleTimeString(
                      undefined,
                      { hour: "numeric", minute: "2-digit" }
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="panel dvr-danger-panel">
          <p className="map-kicker">Clear recordings</p>
          <p className="muted small">
            Clear this day removes the selected driver’s path for the day above.
            Clear all DVR wipes every driver’s track history for this org.
          </p>
          <div className="dvr-danger-actions">
            <button
              type="button"
              className="ghost danger-ghost"
              disabled={!selectedId || clearing != null}
              onClick={() => void clearThisDay()}
            >
              {clearing === "day" ? "Clearing…" : "Clear this day"}
            </button>
            <button
              type="button"
              className="ghost danger-ghost"
              disabled={clearing != null}
              onClick={() => void clearAllDvr()}
            >
              {clearing === "all" ? "Clearing…" : "Clear all DVR"}
            </button>
          </div>
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
        {error && (
          <div className="map-error-overlay" role="alert">
            <p className="map-error-title">Map unavailable</p>
            <p>{error}</p>
          </div>
        )}
        {!mapReady && !error && <div className="map-loading">Loading map…</div>}
      </div>
    </div>
  );
}
