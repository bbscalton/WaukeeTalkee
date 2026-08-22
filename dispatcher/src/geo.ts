/** Client-side geo helpers (meters) for Map DVR stop detection + route preview. */

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

export type DetectedStop = {
  id: string;
  lat: number;
  lng: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Index into track points at stop start (for scrub). */
  pointIndex: number;
};

/**
 * Detect stops: speed ≈ 0 or movement under threshold for ≥ minDurationMs.
 */
export function detectStops(
  points: {
    lat: number;
    lng: number;
    speed: number | null;
    tMs: number;
  }[],
  opts?: {
    minDurationMs?: number;
    maxSpeedMps?: number;
    maxMoveM?: number;
  }
): DetectedStop[] {
  const minDurationMs = opts?.minDurationMs ?? 45_000;
  const maxSpeedMps = opts?.maxSpeedMps ?? 1.2;
  const maxMoveM = opts?.maxMoveM ?? 25;
  if (points.length < 2) return [];

  const stops: DetectedStop[] = [];
  let i = 0;
  while (i < points.length) {
    const start = points[i]!;
    const slow =
      (start.speed != null && start.speed <= maxSpeedMps) ||
      start.speed == null;
    if (!slow) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let sumLat = start.lat;
    let sumLng = start.lng;
    let count = 1;
    while (j < points.length) {
      const p = points[j]!;
      const moved = haversineM(
        { lat: sumLat / count, lng: sumLng / count },
        { lat: p.lat, lng: p.lng }
      );
      const stillSlow =
        (p.speed != null && p.speed <= maxSpeedMps) || p.speed == null;
      if (!stillSlow || moved > maxMoveM) break;
      sumLat += p.lat;
      sumLng += p.lng;
      count += 1;
      j += 1;
    }
    const end = points[j - 1]!;
    const durationMs = Math.max(0, end.tMs - start.tMs);
    if (durationMs >= minDurationMs && count >= 2) {
      stops.push({
        id: `stop-${i}-${j}`,
        lat: sumLat / count,
        lng: sumLng / count,
        startMs: start.tMs,
        endMs: end.tMs,
        durationMs,
        pointIndex: i,
      });
    }
    i = Math.max(j, i + 1);
  }
  return stops;
}

/** Encode a simple polyline (Google algorithm) for storage. */
export function encodePolyline(path: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";
  const encode = (num: number) => {
    let v = num < 0 ? ~(num << 1) : num << 1;
    let out = "";
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  for (const p of path) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    result += encode(lat - lastLat);
    result += encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}
