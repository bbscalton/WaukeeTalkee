import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/** Des Moines metro — fleet default center. */
export const DEFAULT_CENTER = { lat: 41.58, lng: -93.62 };
export const DEFAULT_ZOOM = 11;

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";

let optionsSet = false;
let mapsLibPromise: Promise<google.maps.MapsLibrary> | null = null;
let streetViewLibPromise: Promise<google.maps.StreetViewLibrary> | null = null;

export function hasGoogleMapsApiKey(): boolean {
  return Boolean(apiKey);
}

function ensureOptions(): void {
  if (!apiKey) {
    throw new Error(
      "Missing VITE_GOOGLE_MAPS_API_KEY. Add it to dispatcher/.env for local builds, or set the GitHub Actions secret for Pages."
    );
  }
  if (!optionsSet) {
    setOptions({ key: apiKey, v: "weekly" });
    optionsSet = true;
  }
}

export function loadMapsLibrary(): Promise<google.maps.MapsLibrary> {
  ensureOptions();
  if (!mapsLibPromise) {
    mapsLibPromise = importLibrary("maps");
  }
  return mapsLibPromise;
}

export function loadStreetViewLibrary(): Promise<google.maps.StreetViewLibrary> {
  ensureOptions();
  if (!streetViewLibPromise) {
    streetViewLibPromise = importLibrary("streetView");
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
