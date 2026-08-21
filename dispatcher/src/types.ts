export type Driver = {
  id: string;
  displayName: string;
  plate: string | null;
  pairStatus: "unpaired" | "paired";
  deviceId: string | null;
  onDuty: boolean;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeed: number | null;
  lastHeading: number | null;
  lastTelemetryAt: { seconds: number; nanoseconds: number } | null;
};

export function speedKmh(mps: number | null | undefined): number | null {
  if (mps == null || Number.isNaN(mps)) return null;
  return mps * 3.6;
}

export function formatSpeed(mps: number | null | undefined): string {
  const kmh = speedKmh(mps);
  if (kmh == null) return "—";
  return `${kmh.toFixed(0)} km/h`;
}

export function formatAge(ts: Driver["lastTelemetryAt"] | { toMillis: () => number } | null): string {
  if (!ts) return "never";
  let seconds: number | null = null;
  if ("seconds" in ts && typeof ts.seconds === "number") {
    seconds = ts.seconds;
  } else if ("toMillis" in ts && typeof ts.toMillis === "function") {
    seconds = Math.floor(ts.toMillis() / 1000);
  }
  if (seconds == null) return "never";
  const sec = Math.max(0, Math.round((Date.now() - seconds * 1000) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}
