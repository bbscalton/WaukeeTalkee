import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db, ORG_ID } from "../firebase";
import { PushToTalk } from "../components/PushToTalk";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  driverMarkerFill,
  hasGoogleMapsApiKey,
  loadMapsLibrary,
  loadStreetViewLibrary,
  MAP_LOAD_TIMEOUT_MESSAGE,
  MAP_UI_OPTIONS,
  markerIcon,
  onGoogleMapsAuthFailure,
} from "../googleMaps";
import { formatAge, formatSpeed, RADIO_RETENTION_DAYS, type Driver } from "../types";
import { useRadioArchive } from "../useRadioArchive";

type MapMode = "streets" | "satellite";

function hasFix(d: Driver): boolean {
  return (
    d.lastLat != null &&
    d.lastLng != null &&
    Number.isFinite(d.lastLat) &&
    Number.isFinite(d.lastLng) &&
    !(d.lastLat === 0 && d.lastLng === 0)
  );
}

function mapTypeForMode(mode: MapMode): string {
  return mode === "satellite" ? "hybrid" : "roadmap";
}

export function MapPage() {
  const [search, setSearch] = useSearchParams();
  const mapNode = useRef<HTMLDivElement | null>(null);
  const panoNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    search.get("driver")
  );
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("satellite");
  const [streetViewOpen, setStreetViewOpen] = useState(false);
  const [streetViewStatus, setStreetViewStatus] = useState<string | null>(null);
  const { unreadByDriver } = useRadioArchive();

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
        google.maps.event.trigger(map, "resize");
      } catch (err) {
        window.clearTimeout(loadTimer);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Google Maps");
        }
      }
    })();

    const onWinResize = () => {
      const map = mapRef.current;
      if (map) google.maps.event.trigger(map, "resize");
    };
    window.addEventListener("resize", onWinResize);

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
      unsubAuth();
      window.removeEventListener("resize", onWinResize);
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      panoramaRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(mapTypeForMode(mapMode));
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
          const fromUrl = search.get("driver");
          if (fromUrl && rows.some((r) => r.id === fromUrl)) return fromUrl;
          if (prev && rows.some((r) => r.id === prev)) return prev;
          const first = rows.find((r) => r.pairStatus === "paired");
          return first?.id ?? null;
        });
      },
      (err) => setError(err.message)
    );
  }, [search]);

  const selectDriverRef = useRef<(id: string) => void>(() => undefined);
  const selectDriver = (id: string) => {
    setSelectedId(id);
    const next = new URLSearchParams(search);
    next.set("driver", id);
    setSearch(next, { replace: true });
  };
  selectDriverRef.current = selectDriver;

  const lastFlyRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const located = drivers.filter(
      (d) => (d.pairStatus === "paired" || d.onDuty) && hasFix(d)
    );
    const seen = new Set<string>();

    for (const d of located) {
      seen.add(d.id);
      const position = { lat: d.lastLat!, lng: d.lastLng! };
      const selected = selectedId === d.id;
      const fill = driverMarkerFill(d.onDuty, selected);
      let marker = markersRef.current.get(d.id);
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position,
          title: d.displayName,
          icon: markerIcon(fill, selected),
          zIndex: selected ? 10 : 1,
        });
        marker.addListener("click", () => selectDriverRef.current(d.id));
        markersRef.current.set(d.id, marker);
      } else {
        marker.setPosition(position);
        marker.setIcon(markerIcon(fill, selected));
        marker.setZIndex(selected ? 10 : 1);
        marker.setTitle(d.displayName);
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    }

    const focus = located.find((d) => d.id === selectedId) ?? located[0];
    const flyKey = focus ? `${focus.id}:${selectedId ?? ""}` : null;
    if (focus && flyKey !== lastFlyRef.current) {
      lastFlyRef.current = flyKey;
      map.panTo({ lat: focus.lastLat!, lng: focus.lastLng! });
      if ((map.getZoom() ?? DEFAULT_ZOOM) < 14) {
        map.setZoom(14);
      }
    }

    google.maps.event.trigger(map, "resize");
  }, [drivers, selectedId, mapReady]);

  useEffect(() => {
    if (!streetViewOpen || !panoNode.current) return;
    const selected = drivers.find((d) => d.id === selectedId);
    if (!selected || !hasFix(selected)) {
      setStreetViewStatus("Select a driver with GPS to open Street View.");
      return;
    }

    let cancelled = false;
    const position = { lat: selected.lastLat!, lng: selected.lastLng! };

    (async () => {
      try {
        const { StreetViewPanorama, StreetViewService } =
          await loadStreetViewLibrary();
        if (cancelled || !panoNode.current) return;

        const service = new StreetViewService();
        const result = await service.getPanorama({
          location: position,
          radius: 80,
          source: google.maps.StreetViewSource.OUTDOOR,
        });

        if (cancelled || !panoNode.current) return;
        const location = result.data.location?.latLng;
        if (!location) {
          setStreetViewStatus("No Street View imagery near this driver.");
          return;
        }

        setStreetViewStatus(null);
        if (!panoramaRef.current) {
          panoramaRef.current = new StreetViewPanorama(panoNode.current, {
            position: location,
            pov: { heading: selected.lastHeading ?? 0, pitch: 0 },
            zoom: 1,
            addressControl: true,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
          });
          mapRef.current?.setStreetView(panoramaRef.current);
        } else {
          panoramaRef.current.setPosition(location);
          panoramaRef.current.setPov({
            heading: selected.lastHeading ?? 0,
            pitch: 0,
          });
          panoramaRef.current.setVisible(true);
        }
        requestAnimationFrame(() => {
          google.maps.event.trigger(panoramaRef.current!, "resize");
        });
      } catch {
        if (!cancelled) {
          setStreetViewStatus("No Street View imagery near this driver.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streetViewOpen, selectedId, drivers]);

  useEffect(() => {
    if (streetViewOpen) return;
    panoramaRef.current?.setVisible(false);
    mapRef.current?.setStreetView(null);
    setStreetViewStatus(null);
  }, [streetViewOpen]);

  const paired = drivers.filter((d) => d.pairStatus === "paired");
  const selected = drivers.find((d) => d.id === selectedId) ?? null;
  const onDutyCount = drivers.filter((d) => d.onDuty).length;
  const selectedHasFix = selected ? hasFix(selected) : false;
  const selectedUnread = selected ? unreadByDriver.get(selected.id) ?? 0 : 0;

  return (
    <div className="map-layout">
      <aside className="map-side">
        <p className="map-kicker">Fleet radio</p>
        <h1>Talk to drivers</h1>
        <p className="muted">
          {onDutyCount} on duty · {paired.length} paired · archive {RADIO_RETENTION_DAYS}d
        </p>
        <div className="map-quick-links">
          <Link to={selected ? `/inbox?driver=${selected.id}` : "/inbox"}>
            Inbox{selectedUnread > 0 ? ` (${selectedUnread})` : ""}
          </Link>
          <Link to={selected ? `/replay?driver=${selected.id}` : "/replay"}>
            Map DVR
          </Link>
        </div>
        {error && <p className="error">{error}</p>}

        {selected ? (
          <div className="panel detail radio-panel">
            <p className="map-kicker">Channel open</p>
            <h2>
              {selected.displayName}
              {selectedUnread > 0 && (
                <span className="nav-badge">{selectedUnread}</span>
              )}
            </h2>
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
              <button
                type="button"
                className="street-link"
                onClick={() => setStreetViewOpen(true)}
              >
                Open Street View here
              </button>
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
          {paired.map((d) => {
            const unread = unreadByDriver.get(d.id) ?? 0;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={selectedId === d.id ? "selected" : ""}
                  onClick={() => selectDriver(d.id)}
                >
                  <strong>
                    {d.displayName}
                    {unread > 0 && <span className="nav-badge">{unread}</span>}
                  </strong>
                  <span>
                    {d.onDuty ? formatSpeed(d.lastSpeed) : "Off duty"}
                    {hasFix(d) ? "" : " · no GPS"}
                  </span>
                  <span className="talk-hint">
                    {unread > 0
                      ? `${unread} new`
                      : selectedId === d.id
                        ? "Radio open"
                        : "Tap to talk"}
                  </span>
                </button>
              </li>
            );
          })}
          {paired.length === 0 && (
            <li className="muted">No paired drivers yet.</li>
          )}
        </ul>
      </aside>
      <div className={`map-stage${streetViewOpen ? " street-split" : ""}`}>
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
        {streetViewOpen && (
          <div className="street-view-pane">
            <div className="street-view-toolbar">
              <span>Street View</span>
              <button type="button" className="ghost" onClick={() => setStreetViewOpen(false)}>
                Close
              </button>
            </div>
            {streetViewStatus && (
              <p className="street-view-status">{streetViewStatus}</p>
            )}
            <div className="street-view-canvas" ref={panoNode} />
          </div>
        )}
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
