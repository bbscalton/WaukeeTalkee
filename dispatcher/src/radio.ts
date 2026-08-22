import {
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import type { RadioClip, RadioFrom } from "./types";

export function parseRadioClip(
  id: string,
  data: Record<string, unknown>
): RadioClip {
  const from = data.from === "driver" ? "driver" : "dispatch";
  const audienceRaw = data.audience;
  const audience =
    audienceRaw === "peer" ||
    audienceRaw === "group" ||
    audienceRaw === "all" ||
    audienceRaw === "direct"
      ? audienceRaw
      : "direct";
  return {
    id,
    from,
    driverId: String(data.driverId || ""),
    audioBase64: String(data.audioBase64 || ""),
    contentType: String(data.contentType || "audio/mp4"),
    createdAt: (data.createdAt as Timestamp | null) ?? null,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
    dispatchHeardAt: (data.dispatchHeardAt as Timestamp | null) ?? null,
    driverHeardAt: (data.driverHeardAt as Timestamp | null) ?? null,
    lat: typeof data.lat === "number" ? data.lat : null,
    lng: typeof data.lng === "number" ? data.lng : null,
    audience,
    senderDriverId:
      typeof data.senderDriverId === "string" ? data.senderDriverId : null,
    senderDisplayName:
      typeof data.senderDisplayName === "string" ? data.senderDisplayName : null,
    groupId: typeof data.groupId === "string" ? data.groupId : null,
  };
}

export function clipTimeMs(clip: RadioClip): number {
  const ts = clip.createdAt;
  if (!ts) return 0;
  if ("toMillis" in ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  if ("seconds" in ts) return ts.seconds * 1000;
  return 0;
}

export function formatClipTime(clip: RadioClip): string {
  const ms = clipTimeMs(clip);
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  const sec = Math.max(1, Math.round(ms / 1000));
  return `${sec}s`;
}

export function isUnreadForDispatch(clip: RadioClip): boolean {
  if (clip.from !== "driver") return false;
  if (clip.audience === "peer") return false;
  return !clip.dispatchHeardAt;
}

/** Clip belongs on a driver's inbox thread (direct, group, or peer involving them). */
export function clipThreadDriverId(clip: RadioClip): string {
  if (clip.from === "driver") {
    if (clip.audience === "peer") {
      return clip.senderDriverId ?? clip.driverId;
    }
    return clip.driverId;
  }
  return clip.driverId;
}

export function clipBelongsToThread(clip: RadioClip, threadDriverId: string): boolean {
  if (clip.driverId === threadDriverId) return true;
  if (clip.senderDriverId === threadDriverId) return true;
  return clipThreadDriverId(clip) === threadDriverId;
}

export function audienceLabel(clip: RadioClip): string | null {
  switch (clip.audience) {
    case "peer":
      return "Peer";
    case "group":
      return "Group";
    case "all":
      return "Broadcast";
    default:
      return null;
  }
}

export function clipDescription(
  clip: RadioClip,
  nameById: Map<string, string>
): string | null {
  if (clip.audience === "peer" && clip.senderDriverId) {
    const sender = nameById.get(clip.senderDriverId) ?? "Driver";
    const target = nameById.get(clip.driverId) ?? "Driver";
    return `${sender} → ${target}`;
  }
  if (clip.audience === "group" && clip.from === "driver" && clip.senderDriverId) {
    const sender = nameById.get(clip.senderDriverId) ?? "Driver";
    return `${sender} · group`;
  }
  if (clip.audience === "all") return "Fleet broadcast";
  if (clip.audience === "group" && clip.from === "dispatch") return "Group broadcast";
  return null;
}

export function isUnreadForDriver(clip: RadioClip): boolean {
  return clip.from === "dispatch" && !clip.driverHeardAt;
}

/** Dispatch→driver clip the driver has not played / live-heard yet. */
export function isUnheardOutbound(clip: RadioClip): boolean {
  return isUnreadForDriver(clip);
}

function timestampMs(
  ts: RadioClip["driverHeardAt"] | RadioClip["createdAt"]
): number {
  if (!ts) return 0;
  if ("toMillis" in ts && typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  if ("seconds" in ts) return ts.seconds * 1000;
  return 0;
}

/** Discreet label for outbound clips only (dispatcher UI). */
export function driverHeardLabel(clip: RadioClip): string | null {
  if (clip.from !== "dispatch") return null;
  const heardMs = timestampMs(clip.driverHeardAt);
  if (!heardMs) return "Not heard";
  const when = new Date(heardMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Heard · ${when}`;
}

export function playClipAudio(clip: RadioClip): HTMLAudioElement {
  const audio = new Audio(`data:${clip.contentType};base64,${clip.audioBase64}`);
  void audio.play();
  return audio;
}

export async function markDispatchHeard(clipId: string): Promise<void> {
  await updateDoc(doc(db, "orgs", ORG_ID, "radio", clipId), {
    dispatchHeardAt: serverTimestamp(),
  });
}

/** Hard-delete clip for both dispatcher and driver (same Firestore doc). */
export async function deleteRadioClip(clipId: string): Promise<void> {
  await deleteDoc(doc(db, "orgs", ORG_ID, "radio", clipId));
}

export function speakerLabel(
  from: RadioFrom,
  driverName: string
): string {
  return from === "dispatch" ? "Dispatch" : driverName;
}

/** Last 7 calendar days as yyyy-MM-dd (local), newest first. */
export function lastSevenDayKeys(now = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(toDayKey(d));
  }
  return days;
}

export function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive local-midnight window for a yyyy-MM-dd calendar day in the
 *  browser's timezone. Firestore Timestamps are absolute UTC; comparing
 *  local midnights keeps "Today" aligned with what the dispatcher sees. */
export function dayBounds(dayKey: string): { start: Date; end: Date } {
  const [y, m, d] = dayKey.split("-").map(Number);
  const start = new Date(y!, m! - 1, d!, 0, 0, 0, 0);
  const end = new Date(y!, m! - 1, d! + 1, 0, 0, 0, 0);
  return { start, end };
}

export function formatDayLabel(dayKey: string): string {
  const { start } = dayBounds(dayKey);
  const today = toDayKey(new Date());
  if (dayKey === today) return `Today · ${dayKey}`;
  return start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
