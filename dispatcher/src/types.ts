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

export type RadioFrom = "dispatch" | "driver";

/** PTT clip stored under orgs/{orgId}/radio (7-day archive). */
export type RadioClip = {
  id: string;
  from: RadioFrom;
  driverId: string;
  audioBase64: string;
  contentType: string;
  createdAt: { seconds: number; nanoseconds: number } | null;
  durationMs: number | null;
  dispatchHeardAt: { seconds: number; nanoseconds: number } | null;
  driverHeardAt: { seconds: number; nanoseconds: number } | null;
};

export type TrackPoint = {
  id: string;
  t: { seconds: number; nanoseconds: number } | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
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
