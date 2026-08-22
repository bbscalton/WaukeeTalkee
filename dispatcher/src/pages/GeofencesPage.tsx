import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import { encodePolyline } from "../geo";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  hasGoogleMapsApiKey,
  loadMapsLibrary,
  MAP_LOAD_TIMEOUT_MESSAGE,
  MAP_UI_OPTIONS,
  onGoogleMapsAuthFailure,
} from "../googleMaps";
import type { Driver, Place, PlaceType, SavedRoute } from "../types";

type MapMode = "streets" | "satellite";

function mapTypeForMode(mode: MapMode): string {
  return mode === "satellite" ? "hybrid" : "roadmap";
}

export function GeofencesPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circlesRef = useRef<Map<string, google.maps.Circle>>(new Map());
  const routeLinesRef = useRef<google.maps.Polyline[]>([]);
  const clickListener = useRef<google.maps.MapsEventListener | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("satellite");
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [placeName, setPlaceName] = useState("");
  const [placeType, setPlaceType] = useState<PlaceType>("home_base");
  const [radiusM, setRadiusM] = useState(120);
  const [draftLat, setDraftLat] = useState<number | null>(null);
  const [draftLng, setDraftLng] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [routeName, setRouteName] = useState("");
  const [fromPlaceId, setFromPlaceId] = useState("");
  const [toPlaceId, setToPlaceId] = useState("");
  const [corridorWidthM, setCorridorWidthM] = useState(100);
  const [routeDriverId, setRouteDriverId] = useState("");
  const [routeMonitor, setRouteMonitor] = useState(true);
  const [routeSpeedLimit, setRouteSpeedLimit] = useState("");

  const bases = useMemo(
    () => places.filter((p) => p.type === "home_base"),
    [places]
  );
  const checkpoints = useMemo(
    () => places.filter((p) => p.type === "checkpoint"),
    [places]
  );

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "orgs", ORG_ID, "places"), orderBy("name", "asc")),
      (snap) => {
        setPlaces(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              type: data.type === "checkpoint" ? "checkpoint" : "home_base",
              name: String(data.name || "Place"),
              lat: Number(data.lat),
              lng: Number(data.lng),
              radiusM: Number(data.radiusM) || 100,
              createdAt: (data.createdAt as Timestamp | null) ?? null,
              updatedAt: (data.updatedAt as Timestamp | null) ?? null,
            };
          })
        );
      },
      (err) => setError(err.message)
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "orgs", ORG_ID, "routes"), orderBy("createdAt", "desc")),
      (snap) => {
        setRoutes(
          snap.docs.map((d) => {
            const data = d.data();
            const path = Array.isArray(data.path)
              ? (data.path as { lat: number; lng: number }[]).filter(
                  (p) =>
                    p &&
                    typeof p.lat === "number" &&
                    typeof p.lng === "number"
                )
              : [];
            return {
              id: d.id,
              name: String(data.name || "Route"),
              fromPlaceId: String(data.fromPlaceId || ""),
              toPlaceId: String(data.toPlaceId || ""),
              polyline:
                typeof data.polyline === "string" ? data.polyline : null,
              path,
              corridorWidthM: Number(data.corridorWidthM) || 100,
              driverId:
                typeof data.driverId === "string" && data.driverId
                  ? data.driverId
                  : null,
              monitor: data.monitor !== false,
              speedLimitKmh:
                typeof data.speedLimitKmh === "number"
                  ? data.speedLimitKmh
                  : null,
              createdAt: (data.createdAt as Timestamp | null) ?? null,
            };
          })
        );
      },
      (err) => setError(err.message)
    );
  }, []);

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
            lastSpeed:
              typeof data.lastSpeed === "number" ? data.lastSpeed : null,
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
      if (!cancelled && !mapCreated) setError(MAP_LOAD_TIMEOUT_MESSAGE);
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
        google.maps.event.addListenerOnce(map, "idle", () => {
          if (!cancelled) setMapReady(true);
        });
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
      clickListener.current?.remove();
      clickListener.current = null;
      for (const c of circlesRef.current.values()) c.setMap(null);
      circlesRef.current.clear();
      for (const line of routeLinesRef.current) line.setMap(null);
      routeLinesRef.current = [];
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapTypeForMode(mapMode));
  }, [mapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    clickListener.current?.remove();
    if (placing) {
      clickListener.current = map.addListener(
        "click",
        (e: google.maps.MapMouseEvent) => {
          const ll = e.latLng;
          if (!ll) return;
          setDraftLat(ll.lat());
          setDraftLng(ll.lng());
        }
      );
      map.setOptions({ draggableCursor: "crosshair" });
    } else {
      clickListener.current = null;
      map.setOptions({ draggableCursor: undefined });
    }
  }, [placing, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const keep = new Set(places.map((p) => p.id));
    for (const [id, circle] of circlesRef.current) {
      if (!keep.has(id)) {
        circle.setMap(null);
        circlesRef.current.delete(id);
      }
    }

    for (const p of places) {
      const color = p.type === "home_base" ? "#3dd68c" : "#f0b429";
      let circle = circlesRef.current.get(p.id);
      if (!circle) {
        circle = new google.maps.Circle({
          map,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.18,
          editable: false,
          draggable: false,
        });
        circlesRef.current.set(p.id, circle);
      }
      circle.setCenter({ lat: p.lat, lng: p.lng });
      circle.setRadius(p.radiusM);
      circle.setOptions({
        strokeColor: color,
        fillColor: color,
      });
    }

    if (draftLat != null && draftLng != null) {
      let draft = circlesRef.current.get("__draft__");
      if (!draft) {
        draft = new google.maps.Circle({
          map,
          strokeColor: "#ff5d5d",
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: "#ff5d5d",
          fillOpacity: 0.2,
        });
        circlesRef.current.set("__draft__", draft);
      }
      draft.setCenter({ lat: draftLat, lng: draftLng });
      draft.setRadius(radiusM);
    } else {
      const draft = circlesRef.current.get("__draft__");
      if (draft) {
        draft.setMap(null);
        circlesRef.current.delete("__draft__");
      }
    }
  }, [places, draftLat, draftLng, radiusM, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const line of routeLinesRef.current) line.setMap(null);
    routeLinesRef.current = [];
    for (const r of routes) {
      if (r.path.length < 2) continue;
      const line = new google.maps.Polyline({
        map,
        path: r.path,
        strokeColor: r.monitor ? "#f0b429" : "#a8a093",
        strokeOpacity: 0.85,
        strokeWeight: 4,
      });
      routeLinesRef.current.push(line);
    }
  }, [routes, mapReady]);

  async function savePlace(e: FormEvent) {
    e.preventDefault();
    if (draftLat == null || draftLng == null || !placeName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, "orgs", ORG_ID, "places"), {
        type: placeType,
        name: placeName.trim(),
        lat: draftLat,
        lng: draftLng,
        radiusM: Math.max(20, Math.min(50000, Number(radiusM) || 100)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPlaceName("");
      setDraftLat(null);
      setDraftLng(null);
      setPlacing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save place");
    } finally {
      setBusy(false);
    }
  }

  async function removePlace(id: string) {
    if (!window.confirm("Delete this place?")) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "places", id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function buildPath(
    from: Place,
    to: Place
  ): Promise<{ path: { lat: number; lng: number }[]; polyline: string }> {
    try {
      const service = new google.maps.DirectionsService();
      const result = await service.route({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      });
      const overview = result.routes[0]?.overview_path;
      if (overview && overview.length >= 2) {
        const path = overview.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
        return { path, polyline: encodePolyline(path) };
      }
    } catch {
      /* fall through to straight corridor */
    }
    const path = [
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
    ];
    return { path, polyline: encodePolyline(path) };
  }

  async function saveRoute(e: FormEvent) {
    e.preventDefault();
    const from = places.find((p) => p.id === fromPlaceId);
    const to = places.find((p) => p.id === toPlaceId);
    if (!from || !to || !routeName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { path, polyline } = await buildPath(from, to);
      const limit = Number(routeSpeedLimit);
      await addDoc(collection(db, "orgs", ORG_ID, "routes"), {
        name: routeName.trim(),
        fromPlaceId: from.id,
        toPlaceId: to.id,
        path,
        polyline,
        corridorWidthM: Math.max(
          20,
          Math.min(2000, Number(corridorWidthM) || 100)
        ),
        driverId: routeDriverId || null,
        monitor: routeMonitor,
        speedLimitKmh:
          Number.isFinite(limit) && limit > 0 ? Math.round(limit) : null,
        createdAt: serverTimestamp(),
      });
      setRouteName("");
      setRouteSpeedLimit("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save route");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMonitor(route: SavedRoute) {
    try {
      await updateDoc(doc(db, "orgs", ORG_ID, "routes", route.id), {
        monitor: !route.monitor,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function removeRoute(id: string) {
    if (!window.confirm("Delete this route?")) return;
    try {
      await deleteDoc(doc(db, "orgs", ORG_ID, "routes", id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const placeById = (id: string) => places.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="map-layout geofence-layout">
      <aside className="map-side geofence-side">
        <p className="map-kicker">Compliance</p>
        <h1>Bases &amp; routes</h1>
        <p className="muted">
          Drop home bases and checkpoints, then save a corridor home → checkpoint.
          Cloud Functions watch live GPS for arrive / leave / off-route / speed.
        </p>
        {error && <p className="error">{error}</p>}

        <div className="panel">
          <p className="map-kicker">New place</p>
          <form className="stack-form" onSubmit={(e) => void savePlace(e)}>
            <label>
              Type
              <select
                value={placeType}
                onChange={(e) => setPlaceType(e.target.value as PlaceType)}
              >
                <option value="home_base">Home base</option>
                <option value="checkpoint">Checkpoint</option>
              </select>
            </label>
            <label>
              Name
              <input
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                placeholder="Depot / Hotel lobby"
                required
              />
            </label>
            <label>
              Radius (m)
              <input
                type="number"
                min={20}
                max={50000}
                value={radiusM}
                onChange={(e) => setRadiusM(Number(e.target.value))}
              />
            </label>
            <p className="muted small">
              {draftLat != null && draftLng != null
                ? `Pin: ${draftLat.toFixed(5)}, ${draftLng.toFixed(5)}`
                : "Click the map to set the center."}
            </p>
            <div className="dvr-controls">
              <button
                type="button"
                className="ghost"
                onClick={() => setPlacing((v) => !v)}
              >
                {placing ? "Cancel pin" : "Pin on map"}
              </button>
              <button
                type="submit"
                disabled={
                  busy ||
                  draftLat == null ||
                  draftLng == null ||
                  !placeName.trim()
                }
              >
                Save place
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <p className="map-kicker">Home bases ({bases.length})</p>
          <ul className="geofence-list">
            {bases.length === 0 && (
              <li className="muted">None yet — pin a home base first.</li>
            )}
            {bases.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">{p.radiusM}m radius</div>
                </div>
                <button
                  type="button"
                  className="ghost danger-ghost"
                  disabled={busy}
                  onClick={() => void removePlace(p.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <p className="map-kicker" style={{ marginTop: "1rem" }}>
            Checkpoints ({checkpoints.length})
          </p>
          <ul className="geofence-list">
            {checkpoints.length === 0 && (
              <li className="muted">None yet.</li>
            )}
            {checkpoints.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">{p.radiusM}m radius</div>
                </div>
                <button
                  type="button"
                  className="ghost danger-ghost"
                  disabled={busy}
                  onClick={() => void removePlace(p.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <p className="map-kicker">Saved route</p>
          <form className="stack-form" onSubmit={(e) => void saveRoute(e)}>
            <label>
              Name
              <input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder="Usual to airport"
                required
              />
            </label>
            <label>
              From (home base)
              <select
                value={fromPlaceId}
                onChange={(e) => setFromPlaceId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {bases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To (checkpoint)
              <select
                value={toPlaceId}
                onChange={(e) => setToPlaceId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {checkpoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corridor width (m)
              <input
                type="number"
                min={20}
                max={2000}
                value={corridorWidthM}
                onChange={(e) => setCorridorWidthM(Number(e.target.value))}
              />
            </label>
            <label>
              Assign driver (optional)
              <select
                value={routeDriverId}
                onChange={(e) => setRouteDriverId(e.target.value)}
              >
                <option value="">All drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Route speed limit km/h (optional)
              <input
                type="number"
                min={1}
                max={200}
                value={routeSpeedLimit}
                onChange={(e) => setRouteSpeedLimit(e.target.value)}
                placeholder="Uses driver limit if empty"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={routeMonitor}
                onChange={(e) => setRouteMonitor(e.target.checked)}
              />
              Monitor off-route
            </label>
            <button
              type="submit"
              disabled={
                busy || !routeName.trim() || !fromPlaceId || !toPlaceId
              }
            >
              Save route (Directions)
            </button>
          </form>
        </div>

        <div className="panel">
          <p className="map-kicker">Routes ({routes.length})</p>
          <ul className="geofence-list">
            {routes.length === 0 && (
              <li className="muted">No saved routes yet.</li>
            )}
            {routes.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  <div className="muted small">
                    {placeById(r.fromPlaceId)} → {placeById(r.toPlaceId)} ·{" "}
                    {r.corridorWidthM}m
                    {r.monitor ? " · monitoring" : " · paused"}
                    {r.driverId
                      ? ` · ${drivers.find((d) => d.id === r.driverId)?.displayName ?? "driver"}`
                      : ""}
                  </div>
                </div>
                <div className="geofence-list-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void toggleMonitor(r)}
                  >
                    {r.monitor ? "Pause" : "Monitor"}
                  </button>
                  <button
                    type="button"
                    className="ghost danger-ghost"
                    onClick={() => void removeRoute(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
        {error && /Google Maps|VITE_GOOGLE_MAPS|authorization/i.test(error) && (
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
