import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import {
  DEFAULT_CENTER, DEFAULT_ZOOM, hasGoogleMapsApiKey,
  loadMapsLibrary, MAP_UI_OPTIONS,
} from "../googleMaps";
import { type HazardAlert, type HazardType, formatHazardType } from "../types";

export type HazardMapHandle = {
  focusHazard: (h: HazardAlert) => void;
  getPickedLatLng: () => { lat: number; lng: number } | null;
  clearPickMarker: () => void;
  setPickMode: (on: boolean, type: HazardType) => void;
};

type Props = {
  hazards: HazardAlert[];
  mapMode: "streets" | "satellite";
  onPickLocation: (lat: number, lng: number, address: string) => void;
  onConfirm: (id: string) => void;
  onBroadcast: (h: HazardAlert) => void;
  onClear: (id: string) => void;
};

const HAZARD_COLOR: Record<string, string> = {
  police_checkpoint: "#ef4444",
  speed_trap: "#f59e0b",
  road_hazard: "#eab308",
  accident: "#a855f7",
};

const HAZARD_BG: Record<string, string> = {
  police_checkpoint: "rgba(239, 68, 68, 0.15)",
  speed_trap: "rgba(245, 158, 11, 0.15)",
  road_hazard: "rgba(234, 179, 8, 0.15)",
  accident: "rgba(168, 85, 247, 0.15)",
};

export const HazardMap = forwardRef<HazardMapHandle, Props>(function HazardMap(
  { hazards, mapMode, onPickLocation, onConfirm, onBroadcast, onClear },
  ref
) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const pickMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const pickModeRef = useRef(false);
  const pickTypeRef = useRef<HazardType>("police_checkpoint");
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const hazardsRef = useRef(hazards);
  hazardsRef.current = hazards;

  useImperativeHandle(ref, () => ({
    focusHazard(h) {
      if (!mapRef.current || !h.lat || !h.lng) return;
      mapRef.current.panTo({ lat: h.lat, lng: h.lng });
      mapRef.current.setZoom(15);
      const m = markersRef.current.get(h.id);
      if (m && infoRef.current) openInfo(h, m);
    },
    getPickedLatLng: () => pickLatLngRef.current,
    clearPickMarker() {
      pickMarkerRef.current?.setMap(null);
      pickMarkerRef.current = null;
      pickLatLngRef.current = null;
    },
    setPickMode(on, type) {
      pickModeRef.current = on;
      pickTypeRef.current = type;
      if (mapRef.current) {
        mapRef.current.setOptions({ draggableCursor: on ? "crosshair" : "" });
      }
      if (!on) {
        pickMarkerRef.current?.setMap(null);
        pickMarkerRef.current = null;
        pickLatLngRef.current = null;
      }
    },
  }));

  function openInfo(h: HazardAlert, marker: google.maps.Marker) {
    if (!infoRef.current || !mapRef.current) return;
    const col = HAZARD_COLOR[h.type] ?? "#ef4444";
    const bgCol = HAZARD_BG[h.type] ?? "rgba(239,68,68,0.1)";
    const confirmed = h.confirmedByDispatcher;
    
    infoRef.current.setContent(`
      <div style="font-family: system-ui, -apple-system, sans-serif; color:#0f172a; max-width:280px; padding:6px 4px; line-height:1.4">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px">
          <span style="font-weight:800; color:${col}; background:${bgCol}; padding:3px 8px; border-radius:6px; font-size:12px; border: 1px solid ${col}44">
            ${formatHazardType(h.type)}
          </span>
          <span style="font-size:11px; font-weight:700; color:${confirmed ? '#16a34a' : '#d97706'}">
            ${confirmed ? '✅ Confirmed' : '⚠️ Unverified'}
          </span>
        </div>
        
        <div style="font-weight:800; font-size:14px; color:#1e293b; margin-bottom:4px">
          📍 ${h.locationName || "Unknown location"}
        </div>
        
        <div style="font-size:12px; color:#64748b; margin-bottom:8px">
          Reported by: <strong style="color:#334155">${h.driverName}</strong>
          ${h.lat && h.lng ? `<br><span style="font-size:10px; color:#94a3b8">GPS: ${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}</span>` : ''}
        </div>
        
        ${h.notes ? `<div style="font-size:11px; background:#f1f5f9; color:#475569; padding:6px 8px; border-radius:6px; margin-bottom:10px; font-style:italic; border-left:3px solid ${col}">"${h.notes}"</div>` : ""}
        
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; padding-top:6px; border-top:1px solid #e2e8f0">
          ${!confirmed ? `<button onclick="window.__hazardConfirm('${h.id}')" style="background:#22c55e; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:11px; cursor:pointer; font-weight:700; flex:1">✅ Confirm</button>` : ""}
          <button onclick="window.__hazardBroadcast('${h.id}')" style="background:#f59e0b; color:#000; border:none; border-radius:6px; padding:6px 12px; font-size:11px; cursor:pointer; font-weight:800; flex:1">📢 Siren Broadcast</button>
          <button onclick="window.__hazardClear('${h.id}')" style="background:#64748b; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:11px; cursor:pointer">Clear</button>
        </div>
      </div>`);
    infoRef.current.open(mapRef.current, marker);
  }

  // Wire global callbacks for InfoWindow buttons
  useEffect(() => {
    (window as any).__hazardConfirm = (id: string) => onConfirm(id);
    (window as any).__hazardBroadcast = (id: string) => {
      const h = hazardsRef.current.find((x) => x.id === id);
      if (h) onBroadcast(h);
    };
    (window as any).__hazardClear = (id: string) => onClear(id);
  }, [onConfirm, onBroadcast, onClear]);

  // Init map
  useEffect(() => {
    if (!nodeRef.current || mapRef.current || !hasGoogleMapsApiKey()) return;
    let cancelled = false;
    (async () => {
      try {
        const { Map, InfoWindow, Geocoder } = (await loadMapsLibrary()) as any;
        if (cancelled || !nodeRef.current) return;
        const map = new Map(nodeRef.current, {
          ...MAP_UI_OPTIONS,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: mapMode === "satellite" ? "hybrid" : "roadmap",
          styles: [],
        });
        mapRef.current = map;
        infoRef.current = new InfoWindow();
        geocoderRef.current = new Geocoder();

        clickListenerRef.current = map.addListener(
          "click",
          (e: google.maps.MapMouseEvent) => {
            if (!pickModeRef.current || !e.latLng) return;
            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            pickLatLngRef.current = { lat, lng };

            if (pickMarkerRef.current) {
              pickMarkerRef.current.setPosition(e.latLng);
            } else {
              pickMarkerRef.current = new google.maps.Marker({
                map,
                position: e.latLng,
                draggable: true,
                title: "Drop pin here",
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 13,
                  fillColor: HAZARD_COLOR[pickTypeRef.current] ?? "#ef4444",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 3,
                },
                animation: google.maps.Animation.DROP,
              });
              pickMarkerRef.current.addListener(
                "dragend",
                (de: google.maps.MapMouseEvent) => {
                  if (!de.latLng) return;
                  pickLatLngRef.current = {
                    lat: de.latLng.lat(),
                    lng: de.latLng.lng(),
                  };
                  reverseGeocode(de.latLng.lat(), de.latLng.lng());
                }
              );
            }
            reverseGeocode(lat, lng);
          }
        );
      } catch (e) {
        console.error("Map initialization failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function reverseGeocode(lat: number, lng: number) {
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode(
      { location: { lat, lng } },
      (results: any, status: string) => {
        if (status === "OK" && results?.[0]) {
          onPickLocation(lat, lng, results[0].formatted_address);
        } else {
          onPickLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        }
      }
    );
  }

  // Map type toggle
  useEffect(() => {
    mapRef.current?.setMapTypeId(mapMode === "satellite" ? "hybrid" : "roadmap");
  }, [mapMode]);

  // Sync hazard markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const active = hazards.filter((h) => h.status === "active");
    const seen = new Set<string>();
    for (const h of active) {
      if (!h.lat || !h.lng) continue;
      seen.add(h.id);
      const color = HAZARD_COLOR[h.type] ?? "#ef4444";
      let m = markersRef.current.get(h.id);
      if (!m) {
        m = new google.maps.Marker({
          map,
          position: { lat: h.lat, lng: h.lng },
          title: `${formatHazardType(h.type)}: ${h.locationName}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 11,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
          animation: google.maps.Animation.DROP,
        });
        m.addListener("click", () => openInfo(h, m!));
        markersRef.current.set(h.id, m);
      } else {
        m.setPosition({ lat: h.lat, lng: h.lng });
      }
    }
    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    });
  }, [hazards]);

  return (
    <div
      ref={nodeRef}
      style={{ width: "100%", height: "100%", borderRadius: "inherit" }}
    />
  );
});
