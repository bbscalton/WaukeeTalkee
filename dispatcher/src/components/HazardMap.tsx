import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import {
  DEFAULT_CENTER, DEFAULT_ZOOM, hasGoogleMapsApiKey,
  MAP_UI_OPTIONS,
} from "../googleMaps";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
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

const HAZARD_EMOJI: Record<string, string> = {
  police_checkpoint: "👮",
  speed_trap: "⚡",
  road_hazard: "⚠️",
  accident: "💥",
};

/** Build a coloured SVG pin for AdvancedMarkerElement */
function makePinElement(color: string, emoji: string, pulse = false): HTMLElement {
  const outer = document.createElement("div");
  outer.style.cssText = `
    position: relative;
    width: 38px;
    height: 38px;
    cursor: pointer;
  `;

  const circle = document.createElement("div");
  circle.style.cssText = `
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: ${color};
    border: 3px solid #fff;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    line-height: 1;
    ${pulse ? `animation: hazard-pulse 1.4s ease-in-out infinite;` : ""}
  `;
  circle.textContent = emoji;

  if (pulse) {
    if (!document.getElementById("hazard-pulse-style")) {
      const style = document.createElement("style");
      style.id = "hazard-pulse-style";
      style.textContent = `
        @keyframes hazard-pulse {
          0%,100% { box-shadow: 0 0 0 0 ${color}88, 0 2px 10px rgba(0,0,0,0.5); }
          50%      { box-shadow: 0 0 0 10px ${color}00, 0 2px 10px rgba(0,0,0,0.5); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  outer.appendChild(circle);
  return outer;
}

/** Build a crosshair drop-pin element */
function makePickPinElement(color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: ${color};
    border: 4px solid #fff;
    box-shadow: 0 0 0 3px ${color}88, 0 4px 16px rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    cursor: crosshair;
    animation: pick-pin-drop 0.35s cubic-bezier(0.22,1,0.36,1);
  `;
  el.textContent = "📍";

  if (!document.getElementById("pick-pin-drop-style")) {
    const s = document.createElement("style");
    s.id = "pick-pin-drop-style";
    s.textContent = `
      @keyframes pick-pin-drop {
        from { transform: translateY(-30px) scale(1.3); opacity: 0; }
        to   { transform: translateY(0)     scale(1);   opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }

  return el;
}

export const HazardMap = forwardRef<HazardMapHandle, Props>(function HazardMap(
  { hazards, mapMode, onPickLocation, onConfirm, onBroadcast, onClear },
  ref
) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  // Advanced markers for hazard pins
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());

  // Pick-mode state
  const pickMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const pickLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const pickModeRef = useRef(false);
  const pickTypeRef = useRef<HazardType>("police_checkpoint");

  // Keep fresh reference to hazards for InfoWindow callbacks
  const hazardsRef = useRef(hazards);
  hazardsRef.current = hazards;

  // ── Imperative handle ──────────────────────────────────────────────────────
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
      if (pickMarkerRef.current) {
        pickMarkerRef.current.map = null;
        pickMarkerRef.current = null;
      }
      pickLatLngRef.current = null;
    },
    setPickMode(on, type) {
      pickModeRef.current = on;
      pickTypeRef.current = type;
      if (mapRef.current) {
        mapRef.current.setOptions({ draggableCursor: on ? "crosshair" : "" });
      }
      if (!on && pickMarkerRef.current) {
        pickMarkerRef.current.map = null;
        pickMarkerRef.current = null;
        pickLatLngRef.current = null;
      }
    },
  }));

  // ── InfoWindow content builder ─────────────────────────────────────────────
  function openInfo(h: HazardAlert, marker: google.maps.marker.AdvancedMarkerElement) {
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
    infoRef.current.open({ map: mapRef.current, anchor: marker });
  }

  // ── Wire global InfoWindow button callbacks ────────────────────────────────
  useEffect(() => {
    (window as any).__hazardConfirm = (id: string) => onConfirm(id);
    (window as any).__hazardBroadcast = (id: string) => {
      const h = hazardsRef.current.find((x) => x.id === id);
      if (h) onBroadcast(h);
    };
    (window as any).__hazardClear = (id: string) => onClear(id);
  }, [onConfirm, onBroadcast, onClear]);

  // ── Reverse geocode helper ─────────────────────────────────────────────────
  function reverseGeocode(lat: number, lng: number) {
    if (!geocoderRef.current) {
      onPickLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      return;
    }
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

  // ── Map initialisation — load ALL needed libraries up-front ───────────────
  useEffect(() => {
    if (!nodeRef.current || mapRef.current || !hasGoogleMapsApiKey()) return;
    let cancelled = false;

    (async () => {
      try {
        // Ensure API key is configured before importing libraries
        const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
        if (!apiKey) {
          console.error("HazardMap: VITE_GOOGLE_MAPS_API_KEY is not set.");
          return;
        }
        setOptions({ key: apiKey, v: "weekly" });

        // Load all required libraries in parallel
        const [{ Map, InfoWindow }, { AdvancedMarkerElement }, { Geocoder }] =
          await Promise.all([
            importLibrary("maps") as Promise<google.maps.MapsLibrary>,
            importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
            importLibrary("geocoding") as Promise<google.maps.GeocodingLibrary>,
          ]);

        if (cancelled || !nodeRef.current) return;

        const map = new Map(nodeRef.current, {
          ...MAP_UI_OPTIONS,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: mapMode === "satellite" ? "hybrid" : "roadmap",
          mapId: "hazard-map", // required for AdvancedMarkerElement
        });

        mapRef.current = map;
        infoRef.current = new InfoWindow();
        geocoderRef.current = new Geocoder();

        // ── Click handler for pick-mode pin dropping ───────────────────────
        map.addListener("click", async (e: google.maps.MapMouseEvent) => {
          if (!pickModeRef.current || !e.latLng) return;

          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          pickLatLngRef.current = { lat, lng };

          const color = HAZARD_COLOR[pickTypeRef.current] ?? "#ef4444";

          if (pickMarkerRef.current) {
            // Reuse existing pick marker — just move it
            pickMarkerRef.current.position = { lat, lng };
            // Update appearance for new hazard type
            pickMarkerRef.current.content = makePickPinElement(color);
          } else {
            // Create fresh pick marker
            const marker = new AdvancedMarkerElement({
              map,
              position: { lat, lng },
              title: "Drop pin here",
              content: makePickPinElement(color),
              gmpDraggable: true,
            });

            marker.addListener("dragend", () => {
              const pos = marker.position as google.maps.LatLngLiteral | null;
              if (!pos) return;
              const dLat = typeof pos.lat === "function"
                ? (pos as any).lat()
                : (pos as any).lat;
              const dLng = typeof pos.lng === "function"
                ? (pos as any).lng()
                : (pos as any).lng;
              pickLatLngRef.current = { lat: dLat, lng: dLng };
              reverseGeocode(dLat, dLng);
            });

            pickMarkerRef.current = marker;
          }

          reverseGeocode(lat, lng);
        });

        // Sync any hazards that arrived before the map loaded
        syncHazardMarkers(map, AdvancedMarkerElement);
      } catch (err) {
        console.error("HazardMap: initialization failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Map type toggle ────────────────────────────────────────────────────────
  useEffect(() => {
    mapRef.current?.setMapTypeId(mapMode === "satellite" ? "hybrid" : "roadmap");
  }, [mapMode]);

  // ── Sync hazard markers whenever the hazards list changes ─────────────────
  //    We store the latest AdvancedMarkerElement constructor once it loads.
  const AdvancedMarkerElementRef = useRef<typeof google.maps.marker.AdvancedMarkerElement | null>(null);

  async function ensureMarkerClass() {
    if (AdvancedMarkerElementRef.current) return AdvancedMarkerElementRef.current;
    const lib = (await importLibrary("marker")) as google.maps.MarkerLibrary;
    AdvancedMarkerElementRef.current = lib.AdvancedMarkerElement;
    return lib.AdvancedMarkerElement;
  }

  function syncHazardMarkers(
    map: google.maps.Map,
    AME: typeof google.maps.marker.AdvancedMarkerElement
  ) {
    AdvancedMarkerElementRef.current = AME;
    const active = hazardsRef.current.filter((h) => h.status === "active");
    const seen = new Set<string>();

    for (const h of active) {
      if (!h.lat || !h.lng) continue;
      seen.add(h.id);
      const color = HAZARD_COLOR[h.type] ?? "#ef4444";
      const emoji = HAZARD_EMOJI[h.type] ?? "⚠️";

      let m = markersRef.current.get(h.id);
      if (!m) {
        m = new AME({
          map,
          position: { lat: h.lat, lng: h.lng },
          title: `${formatHazardType(h.type)}: ${h.locationName}`,
          content: makePinElement(color, emoji, !h.confirmedByDispatcher),
        });
        // Capture h in closure for click handler
        const hSnapshot = h;
        m.addListener("click", () => {
          const latest = hazardsRef.current.find((x) => x.id === hSnapshot.id) ?? hSnapshot;
          openInfo(latest, m!);
        });
        markersRef.current.set(h.id, m);
      } else {
        m.position = { lat: h.lat, lng: h.lng };
      }
    }

    // Remove markers for hazards no longer active
    markersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.map = null;
        markersRef.current.delete(id);
      }
    });
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return; // map not yet initialised; syncHazardMarkers() is called inside init

    (async () => {
      try {
        const AME = await ensureMarkerClass();
        syncHazardMarkers(map, AME);
      } catch (err) {
        console.error("HazardMap: failed to sync markers:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazards]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={nodeRef}
      style={{ width: "100%", height: "100%", borderRadius: "inherit" }}
    />
  );
});
