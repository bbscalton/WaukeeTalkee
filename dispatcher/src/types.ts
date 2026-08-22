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
  /** Dispatcher-set recommended speed limit (km/h). Null = no alert. */
  speedLimitKmh: number | null;
};

export type RadioFrom = "dispatch" | "driver";

/** Who receives / how the clip was routed. */
export type RadioAudience = "direct" | "peer" | "group" | "all";

export type RadioGroup = {
  id: string;
  name: string;
  memberDriverIds: string[];
  createdAt: { seconds: number; nanoseconds: number } | null;
  updatedAt: { seconds: number; nanoseconds: number } | null;
};

/** PTT clip stored under orgs/{orgId}/radio (7-day archive). */
export type RadioClip = {
  id: string;
  from: RadioFrom;
  /** Recipient routing key (inbox thread + driver playback filter). */
  driverId: string;
  audioBase64: string;
  contentType: string;
  createdAt: { seconds: number; nanoseconds: number } | null;
  durationMs: number | null;
  dispatchHeardAt: { seconds: number; nanoseconds: number } | null;
  driverHeardAt: { seconds: number; nanoseconds: number } | null;
  lat: number | null;
  lng: number | null;
  audience: RadioAudience;
  /** Set when from=driver and not direct-to-dispatch. */
  senderDriverId: string | null;
  senderDisplayName: string | null;
  groupId: string | null;
};

export type TrackPoint = {
  id: string;
  t: { seconds: number; nanoseconds: number } | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
};

export type PlaceType = "home_base" | "checkpoint";

export type Place = {
  id: string;
  type: PlaceType;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  createdAt: { seconds: number; nanoseconds: number } | null;
  updatedAt: { seconds: number; nanoseconds: number } | null;
};

export type RoutePathPoint = { lat: number; lng: number };

export type SavedRoute = {
  id: string;
  name: string;
  fromPlaceId: string;
  toPlaceId: string;
  polyline: string | null;
  path: RoutePathPoint[];
  corridorWidthM: number;
  driverId: string | null;
  monitor: boolean;
  speedLimitKmh: number | null;
  createdAt: { seconds: number; nanoseconds: number } | null;
};

export type FleetEventType =
  | "place_arrived"
  | "place_dwell"
  | "place_left"
  | "off_route"
  | "speed_alert";

export type FleetEvent = {
  id: string;
  type: FleetEventType;
  driverId: string;
  driverName: string;
  placeId: string | null;
  placeName: string | null;
  placeType: PlaceType | null;
  dwellMs: number | null;
  at: { seconds: number; nanoseconds: number } | null;
  meta: Record<string, unknown> | null;
};

export const RADIO_RETENTION_DAYS = 7;

export type ContactType = "customer" | "hotel" | "account";

export type Contact = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  address: string;
  pickupPreference: string;
  type: ContactType;
  tags: string[];
  createdAt: { seconds: number; nanoseconds: number } | null;
  updatedAt: { seconds: number; nanoseconds: number } | null;
};

export type BookingStatus =
  | "new"
  | "assigned"
  | "en_route"
  | "completed"
  | "cancelled";

export type BookingPickupMode = "asap" | "scheduled";

export type Booking = {
  id: string;
  passengerName: string;
  phone: string;
  contactId: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  pickupMode: BookingPickupMode;
  pickupAt: { seconds: number; nanoseconds: number } | null;
  status: BookingStatus;
  assignedDriverId: string | null;
  notes: string;
  createdAt: { seconds: number; nanoseconds: number } | null;
  updatedAt: { seconds: number; nanoseconds: number } | null;
};

export const CONTACT_TYPES: ContactType[] = ["customer", "hotel", "account"];

export const BOOKING_STATUSES: BookingStatus[] = [
  "new",
  "assigned",
  "en_route",
  "completed",
  "cancelled",
];

export function formatBookingStatus(status: BookingStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "assigned":
      return "Assigned";
    case "en_route":
      return "En route";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "#";
}

export function speedKmh(mps: number | null | undefined): number | null {
  if (mps == null || Number.isNaN(mps)) return null;
  return mps * 3.6;
}

export function formatSpeed(mps: number | null | undefined): string {
  const kmh = speedKmh(mps);
  if (kmh == null) return "—";
  return `${kmh.toFixed(0)} km/h`;
}

export function formatDwellMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatFleetEventType(type: FleetEventType): string {
  switch (type) {
    case "place_arrived":
      return "Arrived";
    case "place_dwell":
      return "Dwell";
    case "place_left":
      return "Left";
    case "off_route":
      return "Off route";
    case "speed_alert":
      return "Speed";
  }
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
