import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db, ORG_ID } from "./firebase";
import type { RadioAudience } from "./types";

export type RadioSendPayload = {
  from: "dispatch" | "driver";
  driverId: string;
  audioBase64: string;
  contentType: string;
  durationMs: number;
  audience: RadioAudience;
  lat?: number;
  lng?: number;
  senderDriverId?: string;
  senderDisplayName?: string;
  groupId?: string;
};

export type RadioClipRef = {
  driverId: string;
  clipId: string;
};

async function writeClip(payload: RadioSendPayload): Promise<string> {
  const doc: Record<string, unknown> = {
    from: payload.from,
    driverId: payload.driverId,
    audioBase64: payload.audioBase64,
    contentType: payload.contentType,
    durationMs: payload.durationMs,
    audience: payload.audience,
    createdAt: serverTimestamp(),
  };
  if (typeof payload.lat === "number" && typeof payload.lng === "number") {
    doc.lat = payload.lat;
    doc.lng = payload.lng;
  }
  if (payload.senderDriverId) doc.senderDriverId = payload.senderDriverId;
  if (payload.senderDisplayName) doc.senderDisplayName = payload.senderDisplayName;
  if (payload.groupId) doc.groupId = payload.groupId;
  const ref = await addDoc(collection(db, "orgs", ORG_ID, "radio"), doc);
  return ref.id;
}

/** Dispatch → one driver (direct). */
export async function sendDirectToDriver(
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId"> & {
    driverId: string;
  }
): Promise<string> {
  return writeClip({ ...payload, from: "dispatch", audience: "direct" });
}

/** Dispatch → every paired driver in the org. */
export async function broadcastToAllDrivers(
  memberIds: string[],
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId">
): Promise<{ sent: number; clips: RadioClipRef[] }> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const clips = await Promise.all(
    ids.map(async (driverId) => ({
      driverId,
      clipId: await writeClip({
        ...payload,
        from: "dispatch",
        driverId,
        audience: "all",
      }),
    }))
  );
  return { sent: ids.length, clips };
}

/** Dispatch → each member of a group. */
export async function broadcastToGroupMembers(
  memberIds: string[],
  groupId: string,
  payload: Omit<RadioSendPayload, "from" | "audience" | "driverId" | "groupId">
): Promise<{ sent: number; clips: RadioClipRef[] }> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const clips = await Promise.all(
    ids.map(async (driverId) => ({
      driverId,
      clipId: await writeClip({
        ...payload,
        from: "dispatch",
        driverId,
        audience: "group",
        groupId,
      }),
    }))
  );
  return { sent: ids.length, clips };
}
