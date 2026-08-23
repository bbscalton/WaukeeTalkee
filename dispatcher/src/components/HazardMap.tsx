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
  police_checkpoint: "#ff4444",
  speed_trap: "#ff9f43",
  road_hazard: "#f1c40f",
  accident: "#a855f7",
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
    const col = HAZARD_COLOR[h.type] ?? "#ff4444";
    const confirmed = h.confirmedByDispatcher;
    infoRef.current.setContent(`
      <div style="font-family:system-ui;color:#111;max-width:260px;padding:2px">
        <div style="font-weight:800;color:${col};font-size:13px;margin-bottom:4px">${formatHazardType(h.type)}</div>
        <div style="font-weight:700;font-size:12px;margin-bottom:2px">📍 ${h.locationName || "Unknown location"}</div>
        <div style="font-size:11px;color:#555;margin-bottom:6px">
          By <b>${h.driverName}</b> · ${confirmed ? "✅ Confirmed" : "⚠️ Unconfirmed"}
        </div>
        ${h.notes ? `<div style="font-size:10px;background:#f3f3f3;padding:4px 6px;border-radius:4px;margin-bottom:8px;font-style:italic">"${h.notes}"</div>` : ""}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${!confirmed ? `<button onclick="window.__hazardConfirm('${h.id}')" style="background:#22c55e;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:700">Confirm</button>` : ""}
          <button onclick="window.__hazardBroadcast('${h.id}')" style="background:#f59e0b;color:#000;border:none;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:700">📢 Broadcast</button>
          <button onclick="window.__hazardClear('${h.id}')" style="background:#555;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer">Clear</button>
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
        const { Map, InfoWindow, Geocoder } = await loadMapsLibrary() as any;
        if (cancelled || !nodeRef.current) return;
        const map = new Map(nodeRef.current, {
          ...MAP_UI_OPTIONS,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: "hybrid",
          styles: [],
        });
        mapRef.current = map;
        infoRef.current = new InfoWindow();
        geocoderRef.current = new Geocoder();

        clickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
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
                scale: 12,
                fillColor: HAZARD_COLOR[pickTypeRef.current] ?? "#ff4444",
                fillOpacity: 1,
                strokeColor: "#fff",
                strokeWeight: 3,
              },
              animation: google.maps.Animation.DROP,
            });
            pickMarkerRef.current.addListener("dragend", (de: google.maps.MapMouseEvent) => {
              if (!de.latLng) return;
              pickLatLngRef.current = { lat: de.latLng.lat(), lng: de.latLng.lng() };
              reverseGeocode(de.latLng.lat(), de.latLng.lng());
            });
          }
          reverseGeocode(lat, lng);
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function reverseGeocode(lat: number, lng: number) {
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ location: { lat, lng } }, (results: any, status: string) => {
      if (status === "OK" && results?.[0]) {
        onPickLocation(lat, lng, results[0].formatted_address);
      } else {
        onPickLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    });
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
      const color = HAZARD_COLOR[h.type] ?? "#ff4444";
      let m = markersRef.current.get(h.id);
      if (!m) {
        m = new google.maps.Marker({
          map,
          position: { lat: h.lat, lng: h.lng },
          title: h.locationName,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2.5 },
          animation: google.maps.Animation.DROP,
        });
        m.addListener("click", () => openInfo(h, m!));
        markersRef.current.set(h.id, m);
      } else {
        m.setPosition({ lat: h.lat, lng: h.lng });
      }
    }
    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) { m.setMap(null); markersRef.current.delete(id); }
    });
  }, [hazards]);

  return (
    <div ref={nodeRef} style={{ width: "100%", height: "100%", borderRadius: "inherit" }} />
  );
});
