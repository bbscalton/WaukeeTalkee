/** Geometry helpers for geofence / corridor compliance (meters). */

export type LatLng = { lat: number; lng: number };

const EARTH_R = 6371000;

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectFactor(lat: number): { mx: number; my: number } {
  const cos = Math.cos((lat * Math.PI) / 180);
  return { mx: EARTH_R * cos * (Math.PI / 180), my: EARTH_R * (Math.PI / 180) };
}

/** Distance from point to segment AB in meters (local tangent plane). */
export function distToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const { mx, my } = projectFactor((a.lat + b.lat + p.lat) / 3);
  const ax = a.lng * mx;
  const ay = a.lat * my;
  const bx = b.lng * mx;
  const by = b.lat * my;
  const px = p.lng * mx;
  const py = p.lat * my;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) {
    return Math.hypot(px - ax, py - ay);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToPathM(p: LatLng, path: LatLng[]): number {
  if (!path.length) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineM(p, path[0]!);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegmentM(p, path[i]!, path[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

/** Decode Google encoded polyline into lat/lng points. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function routePath(route: {
  polyline?: string | null;
  path?: LatLng[] | null;
}): LatLng[] {
  if (Array.isArray(route.path) && route.path.length >= 2) {
    return route.path.filter(
      (p) =>
        p &&
        typeof p.lat === "number" &&
        typeof p.lng === "number" &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng)
    );
  }
  if (typeof route.polyline === "string" && route.polyline.length > 0) {
    return decodePolyline(route.polyline);
  }
  return [];
}
