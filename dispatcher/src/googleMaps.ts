import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/** Guyana — fleet default center. */
export const DEFAULT_CENTER = { lat: 5.835, lng: -58.97 };
export const DEFAULT_ZOOM = 8;

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";

let optionsSet = false;
let mapsLibPromise: Promise<google.maps.MapsLibrary> | null = null;
let streetViewLibPromise: Promise<google.maps.StreetViewLibrary> | null = null;
let authFailureHandlers: Array<(message: string) => void> = [];

const AUTH_FAILURE_MESSAGE =
  "Google Maps authorization failed. Enable Maps JavaScript API for this key, allow billing, and set HTTP referrers to https://bbscalton.github.io/* (plus localhost for local).";

export function hasGoogleMapsApiKey(): boolean {
  return Boolean(apiKey);
}

/** Subscribe to Google Maps auth failures (gm_authFailure). Returns unsubscribe. */
export function onGoogleMapsAuthFailure(
  handler: (message: string) => void
): () => void {
  authFailureHandlers.push(handler);
  return () => {
    authFailureHandlers = authFailureHandlers.filter((h) => h !== handler);
  };
}

function notifyAuthFailure(message: string): void {
  for (const handler of authFailureHandlers) {
    try {
      handler(message);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function installAuthFailureHook(): void {
  const w = window as Window & { gm_authFailure?: () => void };
  const previous = w.gm_authFailure;
  w.gm_authFailure = () => {
    notifyAuthFailure(AUTH_FAILURE_MESSAGE);
    if (typeof previous === "function") previous();
  };
}

function ensureOptions(): void {
  if (!apiKey) {
    throw new Error(
      "Missing VITE_GOOGLE_MAPS_API_KEY. Add it to dispatcher/.env for local builds, or set the GitHub Actions secret for Pages."
    );
  }
  if (!optionsSet) {
    setOptions({ key: apiKey, v: "weekly" });
    installAuthFailureHook();
    optionsSet = true;
  }
}

export function loadMapsLibrary(): Promise<google.maps.MapsLibrary> {
  ensureOptions();
  if (!mapsLibPromise) {
    mapsLibPromise = importLibrary("maps").catch((err) => {
      mapsLibPromise = null;
      throw err instanceof Error
        ? err
        : new Error("Failed to load Google Maps library");
    });
  }
  return mapsLibPromise;
}

export function loadStreetViewLibrary(): Promise<google.maps.StreetViewLibrary> {
  ensureOptions();
  if (!streetViewLibPromise) {
    streetViewLibPromise = importLibrary("streetView").catch((err) => {
      streetViewLibPromise = null;
      throw err instanceof Error
        ? err
        : new Error("Failed to load Google Street View library");
    });
  }
  return streetViewLibPromise;
}

export function markerIcon(
  fill: string,
  selected: boolean
): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 10 : 8,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}

export function driverMarkerFill(onDuty: boolean, selected: boolean): string {
  if (selected) return "#3dd68c";
  if (!onDuty) return "#8a93a0";
  return "#f0b429";
}

export const MAP_UI_OPTIONS: Partial<google.maps.MapOptions> = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: true,
  fullscreenControl: true,
  rotateControl: false,
  scaleControl: false,
  clickableIcons: false,
  gestureHandling: "greedy",
};

/** Friendly message when the Maps script never becomes ready. */
export const MAP_LOAD_TIMEOUT_MESSAGE =
  "Google Maps is taking too long to load. Check the API key, Maps JavaScript API enablement, billing, and HTTP referrer restrictions.";
